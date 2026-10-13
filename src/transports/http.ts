import express from "express"
import { basename, dirname, extname, join, resolve, sep } from "node:path"
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { createMcpServer } from "../server.js"
import { deleteSession } from "../lib/circuit-session.js"
import { getOutputDir } from "../lib/output.js"
import { mimeForFile } from "../lib/artifact-links.js"

interface HttpOptions {
  host: string
  port: number
}

const ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../assets")

/** Escape a string for HTML text and double-quoted attribute contexts. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function htmlShell(title: string, body: string): string {
  const t = esc(title)
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t} — tscircuit-mcp preview</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#101418;color:#e8eaed}
  header{padding:10px 16px;font-size:14px;background:#161b22;border-bottom:1px solid #2a2f37}
  header a{color:#58a6ff}
  main{display:flex;justify-content:center;padding:16px}
  .card{background:#fff;border-radius:8px;max-width:1400px;width:100%;overflow:hidden}
  .card img{width:100%;height:auto;display:block}
  model-viewer{width:100%;height:78vh;background:radial-gradient(#2a2f37,#101418)}
  .fallback{padding:40px;text-align:center;color:#9aa0a6}
</style></head>
<body>
<header>tscircuit-mcp preview — <strong>${t}</strong> &nbsp; <a href="/files">all artifacts</a></header>
<main><div class="card">${body}</div></main>
</body></html>`
}

/** Register artifact preview endpoints: /files (index), /files/:name, /view/:name */
function registerArtifactRoutes(app: express.Express, port: number) {
  const safePath = (name: string): string | null => {
    const dir = getOutputDir()
    const file = basename(name) // strips any path traversal
    const path = resolve(dir, file)
    if (!path.startsWith(resolve(dir) + sep) || !existsSync(path)) return null
    try {
      if (!statSync(path).isFile()) return null
    } catch {
      return null
    }
    return path
  }

  // JSON index of all artifacts
  app.get("/files", (_req, res) => {
    const dir = getOutputDir()
    const files: { name: string; size: number; modified: string; preview_url?: string }[] = []
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      // no output dir yet
    }
    for (const name of entries) {
      try {
        const st = statSync(join(dir, name))
        if (!st.isFile()) continue
        files.push({
          name,
          size: st.size,
          modified: st.mtime.toISOString(),
          preview_url: `/view/${encodeURIComponent(name)}`,
        })
      } catch {
        // entry vanished between readdir and stat — skip it
      }
    }
    files.sort((a, b) => b.modified.localeCompare(a.modified))
    res.json({ count: files.length, files })
  })

  // Interactive PCB viewer (bundled @tscircuit/pcb-viewer)
  // Bundled browser assets (viewer.js, model-viewer.js) — files are written
  // only by our build into ASSETS_DIR, and basename() blocks traversal.
  const assetMime: Record<string, string> = {
    ".js": "application/javascript",
    ".css": "text/css",
    ".wasm": "application/wasm",
    ".json": "application/json",
  }
  app.get("/assets/:name", (req, res) => {
    const file = basename(String(req.params.name))
    const p = join(ASSETS_DIR, file)
    if (!existsSync(p) || !resolve(p).startsWith(ASSETS_DIR + sep)) {
      res.status(404).type("text/plain").send("asset not found")
      return
    }
    res.setHeader("content-type", assetMime[extname(file)] ?? "application/octet-stream")
    res.sendFile(p, (err) => {
      if (err && !res.headersSent) res.status(500).end()
    })
  })

  app.get("/viewer", (req, res) => {
    const file = String(req.query.file ?? "")
    const safeName = basename(file)
    res.send(
      htmlShell(
        safeName ? `interactive PCB — ${safeName}` : "interactive PCB viewer",
        `<div id="status" style="padding:6px 12px;font-size:12px;color:#9aa0a6">loading…</div>
         <div id="root"></div>
         <script src="/assets/viewer.js"></script>`,
      ).replace(
        "</style>",
        `#root{width:100vw;height:100vh}\n  </style>`,
      ),
    )
  })

  // Raw asset serving (svg/csv/glb/json/...)
  app.get("/files/:name", (req, res) => {
    const path = safePath(String(req.params.name))
    if (!path) {
      res.status(404).json({ error: "artifact not found" })
      return
    }
    res.setHeader("content-type", mimeForFile(basename(path)))
    res.sendFile(path, (err) => {
      if (err && !res.headersSent) res.status(500).end()
    })
  })

  // Human/agent-friendly preview page
  app.get("/view/:name", (req, res) => {
    const name = basename(String(req.params.name))
    const path = safePath(name)
    if (!path) {
      res.status(404).send(htmlShell(name, `<div class="fallback">artifact not found</div>`))
      return
    }
    const fileUrl = `/files/${encodeURIComponent(name)}`
    // CircuitJson artifacts open in the interactive PCB viewer
    if (name.endsWith(".circuit.json")) {
      res.redirect(`/viewer?file=${encodeURIComponent(`/files/${name}`)}`)
      return
    }
    if (name.endsWith(".svg")) {
      // Inline the SVG so the page can offer pan/zoom on the drawing itself
      // (works for schematic and PCB exports alike, fully offline).
      const svg = readFileSync(path, "utf-8").replace(/<\?xml[^>]*\?>\s*/, "")
      const panZoom = [
        '<div id="pz" style="width:100%;height:82vh;overflow:hidden;cursor:grab;background:#fff">',
        '<div id="pz-inner" style="transform-origin:0 0;will-change:transform">' + svg + "</div></div>",
        '<div style="padding:4px 12px;font-size:12px;color:#9aa0a6">scroll = zoom · drag = pan · double-click = reset</div>',
        "<script>(() => {",
        '  const box = document.getElementById("pz")',
        '  const inner = document.getElementById("pz-inner")',
        "  let scale = 1, tx = 0, ty = 0, dragging = false, lx = 0, ly = 0",
        '  const apply = () => { inner.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")" }',
        '  const reset = () => { scale = 1; tx = 0; ty = 0; apply() }',
        '  box.addEventListener("wheel", (e) => {',
        "    e.preventDefault()",
        "    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15",
        "    const rect = box.getBoundingClientRect()",
        "    const mx = e.clientX - rect.left, my = e.clientY - rect.top",
        "    tx = mx - (mx - tx) * factor",
        "    ty = my - (my - ty) * factor",
        "    scale = Math.min(40, Math.max(0.05, scale * factor))",
        "    apply()",
        "  }, { passive: false })",
        '  box.addEventListener("mousedown", (e) => { dragging = true; lx = e.clientX; ly = e.clientY; box.style.cursor = "grabbing" })',
        "  window.addEventListener(\"mousemove\", (e) => { if (!dragging) return; tx += e.clientX - lx; ty += e.clientY - ly; lx = e.clientX; ly = e.clientY; apply() })",
        '  window.addEventListener("mouseup", () => { dragging = false; box.style.cursor = "grab" })',
        '  box.addEventListener("dblclick", reset)',
        "  const fit = () => { const w = box.clientWidth; const sw = inner.scrollWidth || w; if (sw > w) { scale = (w / sw) * 0.98; apply() } }",
        "  requestAnimationFrame(fit)",
        "})()</script>",
      ].join("\n")
      res.send(htmlShell(name, panZoom))
      return
    }
    if (name.endsWith(".glb") || name.endsWith(".gltf") || name.endsWith(".gltf.json")) {
      res.send(
        htmlShell(
          name,
          `<model-viewer src="${fileUrl}" camera-controls auto-rotate shadow-intensity="1" exposure="1"></model-viewer>
           <script src="/assets/model-viewer.js"></script>
           <div class="fallback">If the 3D viewer did not load, download the model: <a style="color:#58a6ff" href="${fileUrl}">${name}</a></div>`,
        ),
      )
      return
    }
    // csv / json / anything else: plain text
    const text = readFileSync(path, "utf-8")
    res.send(
      htmlShell(
        name,
        `<pre style="margin:0;padding:16px;background:#fff;color:#111;font-size:13px;overflow:auto;max-height:80vh">${esc(text.slice(0, 2_000_000))}</pre>`,
      ),
    )
  })
}

/**
 * Derive the public base URL for preview links: env override wins, else the
 * request's Host header (works behind port mappings and reverse proxies that
 * preserve Host).
 */
function baseUrlFor(req: express.Request, port: number): string {
  const envBase = process.env.TSCIRCUIT_MCP_PUBLIC_BASE_URL
  if (envBase) return envBase.replace(/\/$/, "")
  const rawHost = (req.headers.host ?? "").toString()
  // Only accept sane hosts (host[:port]); anything else falls back so a
  // crafted Host header can't inject an arbitrary preview URL origin.
  const host = /^[a-zA-Z0-9._-]+(:\d{1,5})?$/.test(rawHost)
    ? rawHost
    : `localhost:${port}`
  const proto = (req.headers["x-forwarded-proto"] ?? "http").toString().split(",")[0]
  return `${proto === "https" ? "https" : "http"}://${host}`
}

/**
 * Start the MCP server over HTTP:
 *
 *  - POST /mcp      Streamable HTTP transport (JSON-RPC over HTTP, session via
 *                   `mcp-session-id` header). This is the current MCP spec.
 *  - GET  /mcp      Server->client SSE stream for the Streamable transport.
 *  - DELETE /mcp    Terminate a Streamable HTTP session.
 *  - GET  /sse      Legacy HTTP+SSE transport endpoint (older clients).
 *  - POST /messages Legacy SSE message endpoint.
 *  - GET  /health   Liveness probe.
 *  - GET  /files    JSON index of persisted artifacts (SVG/CSV/GLB/JSON).
 *  - GET  /files/:name  Raw artifact download.
 *  - GET  /view/:name   Interactive preview page (SVG inline, GLB via <model-viewer>).
 */
export async function startHttpServer({ host, port }: HttpOptions): Promise<void> {
  const app = express()
  app.use(express.json({ limit: "50mb" }))

  registerArtifactRoutes(app, port)

  // --- Streamable HTTP: active sessions -----------------------------
  const streamableTransports = new Map<string, StreamableHTTPServerTransport>()
  const sessionLastSeen = new Map<string, number>()
  const SESSION_TTL_MS = 2 * 60 * 60 * 1000 // reclaim idle sessions after 2h
  const sessionReaper = setInterval(() => {
    const now = Date.now()
    for (const [id, last] of sessionLastSeen) {
      if (now - last > SESSION_TTL_MS) {
        sessionLastSeen.delete(id)
        const t = streamableTransports.get(id)
        if (t) void t.close().catch(() => {})
      }
    }
  }, 30 * 60 * 1000)
  sessionReaper.unref?.()

  app.get("/health", (_req, res) => {
    res.json({ ok: true, transports: ["streamable-http", "sse"], sessions: streamableTransports.size })
  })

  const handleStreamableRequest = async (req: express.Request, res: express.Response) => {
    const headerSessionId = req.headers["mcp-session-id"] as string | undefined
    let transport = headerSessionId ? streamableTransports.get(headerSessionId) : undefined

    if (!transport) {
      // Only `initialize` requests may create a session — anything else
      // without a session id is rejected, otherwise every stray POST would
      // permanently allocate a transport + CircuitSession.
      const bodyMethod = (req.body as { method?: string } | undefined)?.method
      if (bodyMethod !== "initialize") {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: no valid MCP session id (send initialize first)",
          },
        })
        return
      }
      // Use our own key: transport.sessionId is undefined until `initialize`
      // is handled, so keying state on it here would leak the session map.
      const sessionKey = `streamable:${randomUUID()}`
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newId: string) => {
          streamableTransports.set(newId, transport!)
          sessionLastSeen.set(newId, Date.now())
        },
      })
      transport.onclose = () => {
        const id = transport!.sessionId
        if (id) streamableTransports.delete(id)
        sessionLastSeen.delete(id ?? "")
        deleteSession(sessionKey)
      }
      const server = createMcpServer(sessionKey, {
        baseUrl: baseUrlFor(req, port),
      })
      await server.connect(transport)
    } else {
      sessionLastSeen.set(headerSessionId!, Date.now())
    }

    try {
      await transport.handleRequest(req, res, req.body)
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: String(err?.message ?? err) } })
      }
    }
  }

  app.post("/mcp", (req, res) => {
    void handleStreamableRequest(req, res)
  })

  app.get("/mcp", (req, res) => {
    // SSE stream of an existing session (server-initiated notifications)
    const headerSessionId = req.headers["mcp-session-id"] as string | undefined
    const transport = headerSessionId ? streamableTransports.get(headerSessionId) : undefined
    if (!transport) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid MCP session id header" },
      })
      return
    }
    void transport.handleRequest(req, res, req.body)
  })

  app.delete("/mcp", (req, res) => {
    const headerSessionId = req.headers["mcp-session-id"] as string | undefined
    const transport = headerSessionId ? streamableTransports.get(headerSessionId) : undefined
    if (!transport) {
      res.status(404).json({ error: "session not found" })
      return
    }
    void transport.handleRequest(req, res, req.body)
  })

  // --- Legacy HTTP+SSE transport (back-compat) -----------------------
  const sseTransports = new Map<string, SSEServerTransport>()

  app.get("/sse", async (req, res) => {
    const transport = new SSEServerTransport("/messages", res)
    sseTransports.set(transport.sessionId, transport)
    transport.onclose = () => {
      sseTransports.delete(transport.sessionId)
      deleteSession(`sse:${transport.sessionId}`)
    }
    const server = createMcpServer(`sse:${transport.sessionId}`, {
      baseUrl: baseUrlFor(req, port),
    })
    await server.connect(transport)
  })

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string | undefined
    const transport = sessionId ? sseTransports.get(sessionId) : undefined
    if (!transport) {
      res.status(400).json({ error: "unknown sessionId" })
      return
    }
    await transport.handlePostMessage(req, res, req.body)
  })

  // --- Start ----------------------------------------------------------
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const srv = app.listen(port, host, () => resolvePromise())
    // Without an error listener, EADDRINUSE crashes the process with an
    // unhandled 'error' event instead of rejecting into index.ts's catch.
    srv.on("error", (err) => rejectPromise(err))
  })

  console.error(`tscircuit-mcp listening on http://${host}:${port}`)
  console.error(`  Streamable HTTP:  POST http://${host}:${port}/mcp`)
  console.error(`  Legacy SSE:       GET  http://${host}:${port}/sse`)
  console.error(`  Artifacts:        GET  http://${host}:${port}/files  (+ /view/<name> preview)`)
  console.error(`  Health:           GET  http://${host}:${port}/health`)
}
