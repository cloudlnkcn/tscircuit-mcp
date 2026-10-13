import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { Resvg } from "@resvg/resvg-js"
import type { ToolContentItem } from "../types.js"

/**
 * Build an absolute preview URL for an artifact file served by the HTTP
 * transport (`/view/<file>` renders an interactive page, `/files/<file>`
 * serves the raw asset). Returns null in stdio mode (no HTTP server).
 */
export function artifactUrl(baseUrl: string | null, path: string, mode: "view" | "file" = "view"): string | null {
  if (!baseUrl) return null
  const segment = mode === "file" ? "files" : "view"
  return `${baseUrl}/${segment}/${encodeURIComponent(basename(path))}`
}

/**
 * Rasterize an SVG string to PNG bytes for inline MCP image content,
 * so multimodal agents can see the rendered circuit directly.
 */
export function svgToPng(svg: string, width = 1200): Buffer {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "white",
  }).render().asPng()
}

/** Inline image content item from PNG bytes. */
export function imageContent(png: Buffer): ToolContentItem {
  return { type: "image", data: png.toString("base64"), mimeType: "image/png" }
}

/** Read a written artifact back off disk (for rasterizing after save). */
export function readArtifact(path: string): string {
  return readFileSync(path, "utf-8")
}

const KIND_MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".gltf.json": "model/gltf+json",
  ".csv": "text/csv",
  ".json": "application/json",
}

export function mimeForFile(filename: string): string {
  for (const [ext, mime] of Object.entries(KIND_MIME)) {
    if (filename.endsWith(ext)) return mime
  }
  if (filename.endsWith(".gltf")) return "model/gltf+json"
  return "application/octet-stream"
}
