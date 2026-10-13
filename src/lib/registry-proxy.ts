import http from "node:http"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { getImportsFromCode, isStaticAssetPath } from "@tscircuit/eval"

/**
 * Registry cache proxy.
 *
 * tscircuit's evaluator resolves `@tsci/owner.name` imports with a single
 * request: `GET {cjsRegistryUrl}/{owner}/{name}` (compiled CJS text), plus
 * `GET {cjsRegistryUrl}/@tsci/owner.name/{asset}` for static assets (3D
 * models etc.). This module runs a tiny local HTTP server that:
 *
 *   - ONLINE (default): forwards to the upstream registry, caches successful
 *     responses on disk, and serves those on later requests.
 *   - OFFLINE (`TSCIRCUIT_MCP_OFFLINE=1`, or automatically when the upstream
 *     is unreachable and a cached copy exists): serves the disk cache only.
 *
 * The evaluator is pointed at this server, so any component fetched once
 * stays usable with no network at all.
 */

const UPSTREAM_CJS =
  process.env.TSCIRCUIT_CJS_REGISTRY_URL ?? "https://cjs.tscircuit.com"
const UPSTREAM_API =
  process.env.TSCIRCUIT_REGISTRY_API_BASE_URL ?? "https://registry-api.tscircuit.com"

export function getRegistryCacheDir(): string {
  return resolve(
    process.env.TSCIRCUIT_MCP_REGISTRY_CACHE ??
      join(getOutputDirSafe(), "..", "registry-cache"),
  )
}

function getOutputDirSafe(): string {
  return resolve(process.env.TSCIRCUIT_MCP_OUTPUT_DIR ?? join(process.cwd(), "output"))
}

export function isOfflineForced(): boolean {
  return process.env.TSCIRCUIT_MCP_OFFLINE === "1" || process.env.TSCIRCUIT_MCP_OFFLINE === "true"
}

export interface RegistryProxy {
  baseUrl: string
  cjsUrl: string
  apiUrl: string
  port: number
}

let proxyInstance: RegistryProxy | null = null

/** Start the internal cache-proxy server (once). Safe to call repeatedly. */
export async function startRegistryProxy(): Promise<RegistryProxy> {
  if (proxyInstance) return proxyInstance

  const cacheDir = getRegistryCacheDir()
  mkdirSync(join(cacheDir, "cjs"), { recursive: true })
  mkdirSync(join(cacheDir, "assets"), { recursive: true })
  mkdirSync(join(cacheDir, "registry-api"), { recursive: true })

  const server = http.createServer(async (req, res) => {
    try {
      await handleProxyRequest(req, res, cacheDir)
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: false, error: { message: String(err?.message ?? err) } }))
      }
    }
  })

  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen()))
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : 0
  const baseUrl = `http://127.0.0.1:${port}`

  proxyInstance = {
    baseUrl,
    port,
    cjsUrl: `${baseUrl}/cjs`,
    apiUrl: `${baseUrl}/registry-api`,
  }
  return proxyInstance
}

/** Hard cap on a single upstream response we are willing to buffer (100 MB). */
const MAX_UPSTREAM_RESPONSE_BYTES = 100 * 1024 * 1024

async function handleProxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cacheDir: string,
) {
  const url = req.url ?? "/"

  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: { message: "registry proxy only supports GET" } }))
    return
  }

  const offline = isOfflineForced()

  // --- /cjs/<owner>/<name>[/<asset...>] -------------------------------
  if (url.startsWith("/cjs/")) {
    const sub = url.slice("/cjs/".length)
    // Static asset: /cjs/@tsci/owner.name/path/to/file
    if (sub.startsWith("@tsci/")) {
      const upstreamUrl = `${UPSTREAM_CJS}/${sub}`
      return serveWithCache(req, res, {
        cacheDir,
        upstreamUrl,
        cachePath: join(cacheDir, "assets", sha1(upstreamUrl)),
        offline,
        binary: true,
      })
    }
    // Component bundle: /cjs/<owner>/<name>
    return serveWithCache(req, res, {
      cacheDir,
      upstreamUrl: `${UPSTREAM_CJS}/${sub}`,
      cachePath: join(cacheDir, "cjs", sanitize(sub)),
      offline,
    })
  }

  // --- /registry-api/<path> --------------------------------------------
  if (url.startsWith("/registry-api/")) {
    const upstreamUrl = `${UPSTREAM_API}/${url.slice("/registry-api/".length)}`
    return serveWithCache(req, res, {
      cacheDir,
      upstreamUrl,
      cachePath: join(cacheDir, "registry-api", `${sha1(upstreamUrl)}.json`),
      offline,
    })
  }

  res.writeHead(404, { "content-type": "application/json" })
  res.end(JSON.stringify({ ok: false, error: { message: `unknown proxy path ${url}` } }))
}

interface ServeOpts {
  cacheDir: string
  upstreamUrl: string
  cachePath: string
  offline: boolean
  binary?: boolean
}

async function serveWithCache(req: http.IncomingMessage, res: http.ServerResponse, opts: ServeOpts) {
  const { offline, upstreamUrl, cachePath } = opts

  if (offline) {
    if (existsSync(cachePath)) {
      return sendCached(res, cachePath)
    }
    return sendUpstreamStyleError(
      res,
      `Offline mode: "${upstreamUrl}" is not in the local registry cache. ` +
        `Reconnect and call tscircuit_prefetch_components to cache it.`,
    )
  }

  // Online: try upstream, cache on success, fall back to cache on failure.
  let timer: NodeJS.Timeout | undefined
  try {
    const controller = new AbortController()
    timer = setTimeout(() => controller.abort(), 45_000)
    const upstreamRes = await fetch(upstreamUrl, { signal: controller.signal })

    const declaredLength = Number(upstreamRes.headers.get("content-length") ?? 0)
    if (declaredLength > MAX_UPSTREAM_RESPONSE_BYTES) {
      res.writeHead(502, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          ok: false,
          error: { message: `upstream response too large (${declaredLength} bytes)` },
        }),
      )
      return
    }

    const body = Buffer.from(await upstreamRes.arrayBuffer())
    if (body.length > MAX_UPSTREAM_RESPONSE_BYTES) {
      res.writeHead(502, { "content-type": "application/json" })
      res.end(
        JSON.stringify({ ok: false, error: { message: "upstream response too large" } }),
      )
      return
    }

    const usable = upstreamRes.ok && !isUpstreamErrorPayload(body)
    if (usable) {
      writeCacheAtomic(cachePath, body, upstreamRes.headers.get("content-type") ?? undefined)
    } else if (existsSync(cachePath)) {
      // Upstream hiccup (5xx/429) — a cached copy is better than an error.
      return sendCached(res, cachePath)
    }
    res.writeHead(upstreamRes.status, {
      "content-type": upstreamRes.headers.get("content-type") ?? "text/plain",
    })
    res.end(body)
  } catch (err: any) {
    // Network unreachable: fall back to cache transparently.
    if (existsSync(cachePath)) {
      return sendCached(res, cachePath)
    }
    return sendUpstreamStyleError(
      res,
      `Registry unreachable (${String(err?.cause?.code ?? err?.message ?? err).slice(0, 120)}) and ` +
        `"${upstreamUrl}" is not cached locally. Reconnect and run tscircuit_prefetch_components.`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Write cache entry atomically (tmp + rename, so concurrent readers never see
 * a truncated bundle) together with a `.ct` sidecar recording the upstream
 * content-type, which sendCached replays.
 */
function writeCacheAtomic(path: string, body: Buffer, contentType?: string) {
  mkdirSync(join(path, ".."), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, body)
  try {
    if (contentType) writeFileSync(`${tmp}.ct`, contentType, "utf-8")
    renameSync(tmp, path)
    // rename the sidecar after the payload so payload presence implies sidecar
    if (contentType) {
      try {
        renameSync(`${tmp}.ct`, `${path}.ct`)
      } catch {
        // sidecar is best-effort
      }
    }
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch {}
    throw e
  }
}

function sendCached(res: http.ServerResponse, path: string) {
  const body = readFileSync(path)
  let contentType = "text/plain"
  try {
    contentType = readFileSync(`${path}.ct`, "utf-8").trim() || contentType
  } catch {}
  res.writeHead(200, { "content-type": contentType, "x-registry-cache": "hit" })
  res.end(body)
}

function sendUpstreamStyleError(res: http.ServerResponse, message: string) {
  // Shape matches the upstream error payload the evaluator understands.
  res.writeHead(200, { "content-type": "application/json" })
  res.end(JSON.stringify({ ok: false, error: { message, error_code: "registry_cache_miss" } }))
}

/** cjs registry returns 200 with {ok:false,error} for unbuilt packages. */
function isUpstreamErrorPayload(body: Buffer): boolean {
  const trimmed = body.subarray(0, 32).toString("utf-8").trimStart()
  if (!trimmed.startsWith("{")) return false
  try {
    const parsed = JSON.parse(body.toString("utf-8"))
    return parsed?.ok === false
  } catch {
    return false
  }
}

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex")
}

function sanitize(name: string): string {
  // owner/component path under the cache dir. Segments are strictly
  // normalized: non [A-Za-z0-9._-] (including "/" inside a segment and "..")
  // become "_", so the result can never traverse out of the cache directory.
  const parts = name
    .split("/")
    .filter(Boolean)
    .map((p) => p.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.\./g, "_"))
    .filter((p) => p !== "." && p !== "")
  return parts.join("/")
}

/* ------------------------------------------------------------------ */
/* Prefetch API (used by the tscircuit_prefetch_components tool)       */
/* ------------------------------------------------------------------ */

export interface PrefetchResult {
  component: string
  status: "cached" | "already-cached" | "error"
  bytes?: number
  dependencies?: string[]
  error?: string
}

/** Normalize "owner/name" | "@tsci/owner.name" -> { owner, name }. */
export function parseComponentName(raw: string): { owner: string; name: string } | null {
  let s = raw.trim().replace(/^@tsci\//, "")
  const dotForm = s.match(/^([^./]+)\.(.+)$/)
  if (raw.startsWith("@tsci/") && dotForm) {
    return { owner: dotForm[1], name: dotForm[2] }
  }
  const slashForm = s.split("/").filter(Boolean)
  if (slashForm.length === 2) return { owner: slashForm[0], name: slashForm[1] }
  return null
}

function cjsCachePath(owner: string, name: string): string {
  return join(getRegistryCacheDir(), "cjs", sanitize(`${owner}/${name}`))
}

export function isComponentCached(owner: string, name: string): boolean {
  return existsSync(cjsCachePath(owner, name))
}

/**
 * Fetch one component's CJS bundle from upstream into the cache (skipped when
 * already cached), then recurse into its `@tsci/*` imports.
 */
export async function prefetchComponent(
  owner: string,
  name: string,
  opts: { depth?: number; maxDepth?: number; visited?: Set<string>; onProgress?: (msg: string) => void } = {},
): Promise<PrefetchResult> {
  const maxDepth = opts.maxDepth ?? 4
  const depth = opts.depth ?? 0
  const visited = opts.visited ?? new Set<string>()
  const key = `${owner}/${name}`
  const full = `@tsci/${owner}.${name}`
  if (visited.has(full)) {
    return { component: full, status: "already-cached" }
  }
  visited.add(full)

  if (isComponentCached(owner, name)) {
    opts.onProgress?.(`already cached: ${full}`)
    // still recurse deps listed in the cached bundle
    const cached = readFileSync(cjsCachePath(owner, name), "utf-8")
    const deps = await prefetchDependencies(cached, opts)
    return { component: full, status: "already-cached", dependencies: deps }
  }

  if (depth > maxDepth) {
    return { component: full, status: "error", error: `max dependency depth ${maxDepth} exceeded` }
  }

  let body: string
  try {
    const res = await fetch(`${UPSTREAM_CJS}/${owner}/${name}`, {
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      return {
        component: full,
        status: "error",
        error: `upstream HTTP ${res.status} — not caching (the package may not be built)`,
      }
    }
    body = await res.text()
  } catch (err: any) {
    return { component: full, status: "error", error: `fetch failed: ${String(err?.message ?? err).slice(0, 160)}` }
  }

  if (isUpstreamErrorPayload(Buffer.from(body))) {
    const msg = (() => {
      try {
        return JSON.parse(body)?.error?.message ?? "upstream error"
      } catch {
        return "upstream error"
      }
    })()
    return { component: full, status: "error", error: msg }
  }

  mkdirSync(join(cjsCachePath(owner, name), ".."), { recursive: true })
  writeFileSync(cjsCachePath(owner, name), body)
  opts.onProgress?.(`cached: ${full} (${body.length.toLocaleString()} bytes)`)

  const [deps] = await Promise.all([
    prefetchDependencies(body, opts),
    prefetchStaticAssets(owner, name, body, opts),
  ])
  return { component: full, status: "cached", bytes: body.length, dependencies: deps }
}

/**
 * Static asset imports in a bundle (`./assets/foo.obj`) resolve against
 * `{cjsRegistryUrl}/@tsci/owner.name/{asset}`. Fetch them so 3D rendering
 * works offline too. Failure here is non-fatal (the evaluator degrades to a
 * URL placeholder), so errors are logged via onProgress only.
 */
async function prefetchStaticAssets(
  owner: string,
  name: string,
  cjsCode: string,
  opts: { onProgress?: (msg: string) => void },
): Promise<void> {
  let importNames: string[] = []
  try {
    importNames = getImportsFromCode(cjsCode)
  } catch {
    return
  }
  const assetsDir = join(getRegistryCacheDir(), "assets")
  await Promise.all(
    importNames
      .filter((imp) => imp.startsWith("./") && isStaticAssetPath(imp))
      .map(async (imp) => {
        // Normalize "././assets/x" -> "assets/x"; evaluator fetches get
        // path-normalized the same way, so cache keys stay consistent.
        const assetPath = imp.slice(2).replace(/^(\.\/)+/, "")
        const upstreamUrl = `${UPSTREAM_CJS}/@tsci/${owner}.${name}/${assetPath}`
        const cachePath = join(assetsDir, sha1(upstreamUrl))
        if (existsSync(cachePath)) return
        try {
          const res = await fetch(upstreamUrl, { signal: AbortSignal.timeout(60_000) })
          if (!res.ok) {
            opts.onProgress?.(`asset ${assetPath}: upstream ${res.status} (skipped)`)
            return
          }
          const body = Buffer.from(await res.arrayBuffer())
          if (isUpstreamErrorPayload(body)) {
            opts.onProgress?.(`asset ${assetPath}: upstream error payload (skipped)`)
            return
          }
          mkdirSync(assetsDir, { recursive: true })
          writeFileSync(cachePath, body)
          opts.onProgress?.(`cached asset: ${assetPath} (${body.length.toLocaleString()} bytes)`)
        } catch (err: any) {
          opts.onProgress?.(`asset ${assetPath}: ${String(err?.message ?? err).slice(0, 100)}`)
        }
      }),
  )
}

async function prefetchDependencies(
  cjsCode: string,
  opts: { depth?: number; maxDepth?: number; visited?: Set<string>; onProgress?: (msg: string) => void },
): Promise<string[]> {
  const depth = opts.depth ?? 0
  let importNames: string[] = []
  try {
    importNames = getImportsFromCode(cjsCode)
  } catch {
    return []
  }
  const depResults: string[] = []
  await Promise.all(
    importNames
      .filter((imp) => imp.startsWith("@tsci/"))
      .map(async (imp) => {
        const parsed = parseComponentName(imp)
        if (!parsed) return
        const r = await prefetchComponent(parsed.owner, parsed.name, {
          ...opts,
          depth: depth + 1,
        })
        if (r.status !== "error") depResults.push(imp)
        else opts.onProgress?.(`dep error: ${imp} — ${r.error}`)
      }),
  )
  return depResults
}

/* ------------------------------------------------------------------ */
/* Cache status                                                        */
/* ------------------------------------------------------------------ */

export interface CacheStatus {
  cache_dir: string
  offline_mode: boolean
  component_count: number
  asset_count: number
  total_bytes: number
  components: { name: string; bytes: number }[]
}

export function getCacheStatus(): CacheStatus {
  const cacheDir = getRegistryCacheDir()
  const components: { name: string; bytes: number }[] = []
  let assetCount = 0
  let totalBytes = 0

  const cjsDir = join(cacheDir, "cjs")
  if (existsSync(cjsDir)) {
    for (const owner of readdirSync(cjsDir)) {
      const ownerDir = join(cjsDir, owner)
      if (!statSync(ownerDir).isDirectory()) continue
      for (const name of readdirSync(ownerDir)) {
        const p = join(ownerDir, name)
        if (!statSync(p).isFile()) continue
        const size = statSync(p).size
        components.push({ name: `${owner}/${name}`, bytes: size })
        totalBytes += size
      }
    }
  }
  const assetsDir = join(cacheDir, "assets")
  if (existsSync(assetsDir)) {
    assetCount = readdirSync(assetsDir).length
    for (const f of readdirSync(assetsDir)) {
      try {
        totalBytes += statSync(join(assetsDir, f)).size
      } catch {}
    }
  }

  return {
    cache_dir: cacheDir,
    offline_mode: isOfflineForced(),
    component_count: components.length,
    asset_count: assetCount,
    total_bytes: totalBytes,
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
  }
}
