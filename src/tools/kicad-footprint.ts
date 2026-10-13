import { z } from "zod"
import { KicadFootprintToCircuitJsonConverter } from "kicad-to-circuit-json"
import type { AnyCircuitElement } from "circuit-json"
import type { ToolCallback, ToolResult } from "../types.js"
import { writeArtifact } from "../lib/output.js"

const inputSchema = {
  footprint_source: z
    .string()
    .describe(
      'KiCad footprint file content (.kicad_mod / .kicad_pcb s-expression text), e.g. "(module SOP-8 (layer F.Cu) ...)".',
    ),
  filename: z
    .string()
    .optional()
    .default("footprint.kicad_mod")
    .describe("Name to attach to the source (used for conversion diagnostics)."),
}

export const previewKicadFootprint: ToolCallback<typeof inputSchema> = {
  name: "tscircuit_preview_kicad_footprint",
  title: "Preview a KiCad footprint (interactive)",
  description:
    "Convert a KiCad footprint (.kicad_mod s-expression) to CircuitJson and return an interactive " +
    "PCB viewer URL (pan/zoom/pad inspect in the browser, same viewer as tscircuit_render_pcb_svg) " +
    "plus an inline PNG. This is the MCP equivalent of the tscircuit kicad-viewer app.",
  inputSchema,
  annotations: { readOnlyHint: false },

  async execute({ footprint_source, filename }, session, extra) {
    let circuitJson: AnyCircuitElement[]
    try {
      const converter = new KicadFootprintToCircuitJsonConverter()
      converter.addFile(filename || "footprint.kicad_mod", footprint_source)
      converter.runUntilFinished()
      circuitJson = converter.getOutput() as AnyCircuitElement[]
    } catch (err: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `KiCad footprint conversion failed: ${String(err?.message ?? err).slice(0, 1500)}`,
          },
        ],
        isError: true,
      }
    }

    if (!circuitJson || circuitJson.length === 0) {
      return {
        content: [
          { type: "text" as const, text: "Conversion produced no circuit elements — is this a footprint file?" },
        ],
        isError: true,
      }
    }

    const base = (filename || "footprint").replace(/\.(kicad_mod|kicad_pcb|json)$/i, "").replace(/[^a-zA-Z0-9._-]/g, "_")
    const jsonPath = writeArtifact(session, {
      kind: "circuit_json",
      ext: "json",
      base,
      data: JSON.stringify(circuitJson),
      filename: `${base}.circuit.json`,
    })

    const viewerUrl = extra.baseUrl
      ? `${extra.baseUrl}/viewer?file=${encodeURIComponent(`/files/${jsonPath.split("/").pop()}`)}`
      : null

    const lines = [
      `# KiCad footprint converted (${circuitJson.length} elements)`,
      "",
      `- CircuitJson saved to: ${jsonPath}`,
      viewerUrl ? `- Interactive viewer: ${viewerUrl}` : null,
      !viewerUrl
        ? "- (stdio mode: no HTTP viewer; call tscircuit_render_pcb_svg with circuit_json=<this data> for an image)"
        : null,
    ].filter((l): l is string => l !== null)

    const content: ToolResult["content"] = [{ type: "text" as const, text: lines.join("\n") }]
    if (viewerUrl) {
      content.push({
        type: "resource_link" as const,
        uri: viewerUrl,
        name: "Interactive KiCad footprint viewer",
        mimeType: "text/html",
      })
    }
    return { content }
  },
}
