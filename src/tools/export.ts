import { z } from "zod"
import { convertCircuitJsonToGltf } from "circuit-json-to-gltf"
import {
  convertCircuitJsonToPickAndPlaceCsv,
  convertCircuitJsonToPickAndPlaceRows,
} from "circuit-json-to-pnp-csv"
import { convertCircuitJsonToBomRows, convertBomRowsToCsv } from "circuit-json-to-bom-csv"
import type { ToolCallback, ToolContentItem } from "../types.js"
import { resolveCircuitJson } from "../types.js"
import { writeArtifact } from "../lib/output.js"
import { artifactUrl } from "../lib/artifact-links.js"
import type { AnyCircuitElement } from "circuit-json"

/* ------------------------------------------------------------------ */
/* 3D GLB export                                                       */
/* ------------------------------------------------------------------ */

const gltfInput = {
  circuit_json: z.unknown().optional().describe("Optional explicit CircuitJson array (defaults to session circuit)."),
  format: z.enum(["glb", "gltf"]).optional().default("glb").describe("Binary GLB (recommended) or JSON gltf."),
  filename: z.string().optional().describe("Output filename."),
  board_texture_resolution: z
    .number()
    .int()
    .min(64)
    .max(4096)
    .optional()
    .default(512)
    .describe("Board texture render resolution in px."),
}

export const exportGltf: ToolCallback<typeof gltfInput> = {
  name: "tscircuit_export_gltf",
  title: "Export 3D board model (GLB)",
  description:
    "Export the PCB as a 3D model in glTF/GLB format, including board body, copper, silkscreen and " +
    "component 3D models where available. The file is written to the output directory; the absolute " +
    "path is returned so it can be opened in any 3D viewer.",
  inputSchema: gltfInput,
  annotations: { readOnlyHint: false },

  async execute({ circuit_json, format, filename, board_texture_resolution }, session, extra) {
    const cj = resolveCircuitJson(session, circuit_json as AnyCircuitElement[])
    const result = await convertCircuitJsonToGltf(cj as any, {
      format,
      boardTextureResolution: board_texture_resolution ?? 512,
      includeModels: true,
    })
    const isBinary = result instanceof ArrayBuffer
    const data: Buffer = isBinary
      ? Buffer.from(result as ArrayBuffer)
      : Buffer.from(JSON.stringify(result, null, 2), "utf-8")
    const path = writeArtifact(session, {
      kind: "gltf",
      ext: format === "glb" ? "glb" : "gltf.json",
      base: "board-3d",
      data,
      filename,
    })
    const viewUrl = artifactUrl(extra.baseUrl, path, "view")
    const fileUrl = artifactUrl(extra.baseUrl, path, "file")
    const content: ToolContentItem[] = [
      {
        type: "text" as const,
        text:
          `# 3D model exported\n\n` +
          `- Saved to: ${path}\n` +
          `- Format: ${format}\n` +
          `- Size: ${data.length.toLocaleString()} bytes\n` +
          (viewUrl ? `- Interactive 3D preview (orbit/zoom): ${viewUrl}\n` : "") +
          (fileUrl ? `- Direct file URL: ${fileUrl}\n` : "") +
          `\nOpen the preview URL in a browser for an interactive orbit view of the board.`,
      },
    ]
    if (viewUrl) {
      content.push({
        type: "resource_link" as const,
        uri: viewUrl,
        name: "Interactive 3D preview",
        mimeType: "text/html",
      })
    }
    return { content }
  },
}

/* ------------------------------------------------------------------ */
/* Pick & place CSV                                                    */
/* ------------------------------------------------------------------ */

const pnpInput = {
  circuit_json: z.unknown().optional().describe("Optional explicit CircuitJson array (defaults to session circuit)."),
  filename: z.string().optional().describe("Output CSV filename."),
}

export const exportPnpCsv: ToolCallback<typeof pnpInput> = {
  name: "tscircuit_export_pnp_csv",
  title: "Export pick-and-place CSV",
  description:
    "Export component placement as a pick-and-place (PnP) CSV for PCB assembly machines. " +
    "Contains reference designator, x/y position, rotation and layer per component.",
  inputSchema: pnpInput,
  annotations: { readOnlyHint: false },

  async execute({ circuit_json, filename }, session, extra) {
    const cj = resolveCircuitJson(session, circuit_json as AnyCircuitElement[])
    const rows = convertCircuitJsonToPickAndPlaceRows(cj as any)
    const csv = convertCircuitJsonToPickAndPlaceCsv(cj as any)
    const path = writeArtifact(session, { kind: "pnp_csv", ext: "csv", base: "pick-and-place", data: csv, filename })
    const viewUrl = artifactUrl(extra.baseUrl, path, "view")
    return {
      content: [
        {
          type: "text" as const,
          text:
            `# Pick & place exported\n\n- Saved to: ${path}\n- Rows: ${rows.length}\n` +
            (viewUrl ? `- View in browser: ${viewUrl}\n` : "") +
            `\n` +
            "```csv\n" +
            csv.split("\n").slice(0, 12).join("\n") +
            (csv.split("\n").length > 12 ? "\n..." : "") +
            "\n```",
        },
      ],
    }
  },
}

/* ------------------------------------------------------------------ */
/* BOM CSV                                                             */
/* ------------------------------------------------------------------ */

const bomInput = {
  circuit_json: z.unknown().optional().describe("Optional explicit CircuitJson array (defaults to session circuit)."),
  filename: z.string().optional().describe("Output CSV filename."),
}

export const exportBomCsv: ToolCallback<typeof bomInput> = {
  name: "tscircuit_export_bom_csv",
  title: "Export bill-of-materials CSV",
  description:
    "Export the bill of materials (BOM) as CSV: one row per unique component with reference designators, " +
    "description and manufacturer part numbers.",
  inputSchema: bomInput,
  annotations: { readOnlyHint: false },

  async execute({ circuit_json, filename }, session, extra) {
    const cj = resolveCircuitJson(session, circuit_json as AnyCircuitElement[])
    const rows = await convertCircuitJsonToBomRows({ circuitJson: cj as any })
    const csv = convertBomRowsToCsv(rows)
    const path = writeArtifact(session, { kind: "bom_csv", ext: "csv", base: "bom", data: csv, filename })
    const viewUrl = artifactUrl(extra.baseUrl, path, "view")
    return {
      content: [
        {
          type: "text" as const,
          text:
            `# BOM exported\n\n- Saved to: ${path}\n- Lines: ${rows.length}\n` +
            (viewUrl ? `- View in browser: ${viewUrl}\n` : "") +
            `\n\`\`\`csv\n${csv.slice(0, 1200)}\n\`\`\``,
        },
      ],
    }
  },
}

/* ------------------------------------------------------------------ */
/* Raw circuit JSON                                                    */
/* ------------------------------------------------------------------ */

const getCircuitJsonInput = {
  circuit_json: z.unknown().optional().describe("Optional explicit CircuitJson array (defaults to session circuit)."),
  element_type: z
    .string()
    .optional()
    .describe("Filter elements by type, e.g. 'source_component', 'pcb_trace', 'schematic_component'."),
  save_to_file: z.boolean().optional().default(false).describe("Also save the JSON to the output directory."),
}

export const getCircuitJson: ToolCallback<typeof getCircuitJsonInput> = {
  name: "tscircuit_get_circuit_json",
  title: "Get CircuitJson",
  description:
    "Return the CircuitJson of the current session circuit (from the last tscircuit_eval), optionally " +
    "filtered by element type (e.g. 'pcb_trace', 'source_component') and/or saved to a JSON file.",
  inputSchema: getCircuitJsonInput,
  annotations: { readOnlyHint: true },

  async execute({ circuit_json, element_type, save_to_file }, session) {
    let cj = resolveCircuitJson(session, circuit_json as AnyCircuitElement[])
    if (element_type) {
      if (!/^[a-zA-Z0-9_-]+$/.test(element_type)) {
        return {
          content: [{ type: "text" as const, text: `invalid element_type: ${JSON.stringify(element_type)}` }],
          isError: true,
        }
      }
      cj = cj.filter((el) => (el as { type?: string }).type === element_type)
    }
    const json = JSON.stringify(cj, null, 2)

    if (save_to_file) {
      const path = writeArtifact(session, {
        kind: "circuit_json",
        ext: "json",
        base: element_type ? `circuit-${element_type}` : "circuit",
        data: json,
      })
      return {
        content: [
          {
            type: "text" as const,
            text: `CircuitJson (${cj.length} elements${element_type ? ` of type ${element_type}` : ""}) saved to: ${path}`,
          },
        ],
      }
    }

    // Inline, with a size guard
    const MAX = 300_000
    const text =
      json.length <= MAX
        ? "```json\n" + json + "\n```"
        : `CircuitJson is ${json.length.toLocaleString()} bytes — too large to inline. ` +
          `Call again with save_to_file=true, or filter with element_type. First 300k bytes:\n\n` +
          "```json\n" +
          json.slice(0, MAX) +
          "\n```"
    return { content: [{ type: "text" as const, text }] }
  },
}
