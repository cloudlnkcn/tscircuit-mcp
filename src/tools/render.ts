import { z } from "zod"
import {
  convertCircuitJsonToSchematicSvg,
  convertCircuitJsonToPcbSvg,
  convertCircuitJsonToAssemblySvg,
} from "circuit-to-svg"
import type { ToolCallback, ToolResult, ToolContentItem } from "../types.js"
import type { CircuitSession } from "../lib/circuit-session.js"
import { basename } from "node:path"
import { resolveCircuitJson } from "../types.js"
import { writeArtifact } from "../lib/output.js"
import { artifactUrl, svgToPng, imageContent } from "../lib/artifact-links.js"
import type { AnyCircuitElement } from "circuit-json"

const commonInput = {
  circuit_json: z.unknown().optional().describe(
    "Optional explicit CircuitJson array. If omitted, uses the session circuit from the last tscircuit_eval.",
  ),
  filename: z.string().optional().describe("Output SVG filename (written under the output directory)."),
  include_svg_content: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, also return the raw SVG markup in the response (can be large)."),
  png_width: z
    .number()
    .int()
    .min(200)
    .max(4000)
    .optional()
    .default(1200)
    .describe("Width in px of the inline PNG preview returned as image content."),
}

/**
 * Shared result builder for SVG-rendering tools: saves the SVG, renders an
 * inline PNG (so multimodal agents see the circuit immediately) and attaches
 * preview URLs when running over HTTP. Also persists the CircuitJson so the
 * interactive web viewer (/viewer) can render the same circuit.
 */
function renderResult(opts: {
  session: CircuitSession
  svg: string
  path: string
  kind: string
  viewerType?: "pcb" | "schematic"
  baseUrl: string | null
  includeSvg: boolean
  pngWidth: number
  circuitJson: AnyCircuitElement[]
}): ToolResult {
  const content: ToolContentItem[] = []

  // Inline PNG first — this is what the agent "sees"
  try {
    content.push(imageContent(svgToPng(opts.svg, opts.pngWidth)))
  } catch {
    // rasterization failure shouldn't kill the tool result
  }

  // Persist CircuitJson next to the SVG so /viewer can load it interactively
  const jsonFilename = `${basename(opts.path).replace(/\.svg$/, "")}.circuit.json`
  let viewerUrl: string | null = null
  try {
    const jsonPath = writeArtifact(opts.session, {
      kind: "circuit_json",
      ext: "json",
      base: "circuit",
      data: JSON.stringify(opts.circuitJson),
      filename: jsonFilename,
    })
    const viewerType = opts.viewerType === "schematic" ? "schematic" : "pcb"
    viewerUrl = opts.baseUrl
      ? `${opts.baseUrl}/viewer?file=${encodeURIComponent(`/files/${basename(jsonPath)}`)}&type=${viewerType}`
      : null
  } catch {
    // viewer json is best-effort
  }

  const viewUrl = artifactUrl(opts.baseUrl, opts.path, "view")
  const fileUrl = artifactUrl(opts.baseUrl, opts.path, "file")
  const lines = [
    `# ${opts.kind} rendered`,
    "",
    `- Saved to: ${opts.path}`,
    viewerUrl
      ? `- Interactive ${opts.viewerType === "schematic" ? "schematic" : "PCB"} viewer (pan/zoom/inspect): ${viewerUrl}`
      : null,
    viewUrl ? `- Static preview page: ${viewUrl}` : null,
    fileUrl ? `- Direct file URL: ${fileUrl}` : null,
    `- Size: ${opts.svg.length.toLocaleString()} bytes`,
    opts.includeSvg ? "\n## SVG content\n\n```svg\n" + opts.svg + "\n```" : null,
  ].filter((l): l is string => l !== null)

  content.push({ type: "text", text: lines.join("\n") })
  if (viewerUrl) {
    content.push({
      type: "resource_link",
      uri: viewerUrl,
      name: `Interactive ${opts.viewerType === "schematic" ? "schematic" : "PCB"} viewer`,
      mimeType: "text/html",
    })
  }
  return { content }
}

/* ------------------------------------------------------------------ */
/* Schematic SVG                                                       */
/* ------------------------------------------------------------------ */

const schInput = {
  ...commonInput,
  grid: z.boolean().optional().default(false).describe("Draw schematic grid dots."),
}

export const renderSchematicSvg: ToolCallback<typeof schInput> = {
  name: "tscircuit_render_schematic_svg",
  title: "Render schematic SVG",
  description:
    "Render the circuit as a schematic SVG. Returns an inline PNG preview (visible directly in chat), " +
    "saves the SVG to the output directory, and (over HTTP) returns interactive preview URLs. " +
    "Uses the session circuit unless circuit_json is given.",
  inputSchema: schInput,
  annotations: { readOnlyHint: false },

  async execute({ circuit_json, filename, include_svg_content, png_width, grid }, session, extra) {
    const cj = resolveCircuitJson(session, circuit_json as AnyCircuitElement[])
    const svg = convertCircuitJsonToSchematicSvg(cj, { grid: grid === true })
    const path = writeArtifact(session, {
      kind: "schematic_svg",
      ext: "svg",
      base: "schematic",
      data: svg,
      filename,
    })
    return renderResult({
      session,
      svg,
      path,
      kind: "Schematic",
      viewerType: "schematic",
      baseUrl: extra.baseUrl,
      includeSvg: include_svg_content === true,
      pngWidth: png_width ?? 1200,
      circuitJson: cj,
    })
  },
}

/* ------------------------------------------------------------------ */
/* PCB SVG                                                             */
/* ------------------------------------------------------------------ */

const pcbInput = {
  ...commonInput,
  dark_mode: z.boolean().optional().default(false).describe("Render with dark substrate colors."),
}

export const renderPcbSvg: ToolCallback<typeof pcbInput> = {
  name: "tscircuit_render_pcb_svg",
  title: "Render PCB SVG",
  description:
    "Render the circuit as a PCB layout SVG (copper, pads, silkscreen, traces). Returns an inline PNG " +
    "preview (visible directly in chat), saves the SVG, and (over HTTP) returns interactive preview URLs. " +
    "Uses the session circuit unless circuit_json is given.",
  inputSchema: pcbInput,
  annotations: { readOnlyHint: false },

  async execute({ circuit_json, filename, include_svg_content, png_width, dark_mode }, session, extra) {
    const cj = resolveCircuitJson(session, circuit_json as AnyCircuitElement[])
    const svg = convertCircuitJsonToPcbSvg(cj, {
      ...(dark_mode ? { colorOverrides: { substrate: "#1a1a1a", keepout: "#3a1a1a" } } : {}),
    })
    const path = writeArtifact(session, {
      kind: "pcb_svg",
      ext: "svg",
      base: "pcb",
      data: svg,
      filename,
    })
    return renderResult({
      session,
      svg,
      path,
      kind: "PCB",
      baseUrl: extra.baseUrl,
      includeSvg: include_svg_content === true,
      pngWidth: png_width ?? 1200,
      circuitJson: cj,
    })
  },
}

/* ------------------------------------------------------------------ */
/* Assembly SVG                                                        */
/* ------------------------------------------------------------------ */

export const renderAssemblySvg: ToolCallback<typeof commonInput> = {
  name: "tscircuit_render_assembly_svg",
  title: "Render assembly SVG",
  description:
    "Render a realistic 3D-style assembly view SVG of the populated PCB (boards + component 3D models " +
    "when available from the registry). Returns an inline PNG preview, saves the SVG, and (over HTTP) " +
    "returns interactive preview URLs. Uses the session circuit unless circuit_json is given.",
  inputSchema: commonInput,
  annotations: { readOnlyHint: false },

  async execute({ circuit_json, filename, include_svg_content, png_width }, session, extra) {
    const cj = resolveCircuitJson(session, circuit_json as AnyCircuitElement[])
    const svg = convertCircuitJsonToAssemblySvg(cj as any)
    const path = writeArtifact(session, {
      kind: "assembly_svg",
      ext: "svg",
      base: "assembly",
      data: svg,
      filename,
    })
    return renderResult({
      session,
      svg,
      path,
      kind: "Assembly",
      baseUrl: extra.baseUrl,
      includeSvg: include_svg_content === true,
      pngWidth: png_width ?? 1200,
      circuitJson: cj,
    })
  },
}
