import { mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { basename, join, resolve, extname, sep } from "node:path"
import type { CircuitSession } from "./circuit-session.js"

export function getOutputDir(): string {
  return resolve(process.env.TSCIRCUIT_MCP_OUTPUT_DIR ?? join(process.cwd(), "output"))
}

export function ensureOutputDir(): string {
  const dir = getOutputDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

const EXT_TO_KIND: Record<string, string> = {
  ".svg": "svg",
  ".glb": "gltf",
  ".csv": "csv",
  ".json": "json",
}

/**
 * Rebuild a session's artifact index from the output directory. Called when a
 * session is created so that artifacts written before a container restart (or
 * by earlier sessions / the tsci CLI) remain discoverable.
 */
export function hydrateArtifactsFromDisk(session: CircuitSession): void {
  let dir: string
  try {
    dir = ensureOutputDir()
  } catch {
    return
  }
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries.sort()) {
    const path = join(dir, name)
    try {
      if (!statSync(path).isFile()) continue
      const kind = EXT_TO_KIND[extname(name).toLowerCase()] ?? `file`
      session.artifacts.push({
        path,
        kind: kind === "svg" ? guessSvgKind(name) : kind,
        created_at: statSync(path).mtime.toISOString(),
      })
    } catch {
      // ignore unreadable entries
    }
  }
}

function guessSvgKind(name: string): string {
  const n = name.toLowerCase()
  if (n.startsWith("pcb")) return "pcb_svg"
  if (n.startsWith("schematic")) return "schematic_svg"
  if (n.startsWith("assembly")) return "assembly_svg"
  if (n.startsWith("fp-")) return "footprint_svg"
  return "svg"
}

let counter = 0
function timestampedName(base: string, ext: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  counter = (counter + 1) % 10000
  return `${base}-${ts}-${String(counter).padStart(4, "0")}.${ext}`
}

/**
 * Write an artifact (svg/csv/glb/json/...) into the output dir and record it in the session.
 * Returns the absolute path.
 */
export function writeArtifact(
  session: CircuitSession,
  opts: { kind: string; ext: string; base?: string; data: string | Buffer; filename?: string },
): string {
  const dir = ensureOutputDir()
  const filename = basename(
    opts.filename ?? timestampedName(opts.base ?? opts.kind.replace(/_/g, "-"), opts.ext),
  )
  const path = resolve(dir, filename)
  // `filename` may come from tool arguments — never let it escape the dir.
  if (!path.startsWith(dir + sep)) {
    throw new Error(`invalid artifact filename: ${JSON.stringify(opts.filename)}`)
  }
  writeFileSync(path, opts.data)
  session.addArtifact(path, opts.kind)
  return path
}
