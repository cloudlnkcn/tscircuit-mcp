import { z } from "zod"
import { fp, getFootprintNames } from "@tscircuit/footprinter"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { ToolCallback } from "../types.js"
import { writeArtifact } from "../lib/output.js"
import { getSession } from "../lib/circuit-session.js"

const footprintInput = {
  footprint_string: z
    .string()
    .describe(
      "Footprinter string, e.g. 'soic8', 'qfp64', '0603', 'bga64', 'pinrow4_p2.54mm', " +
        "'tssop20', 'sot23-5', 'dip8'. Parameters can be appended with underscores, e.g. 'qfp48_p0.5mm'.",
    ),
  output: z
    .enum(["circuit_json", "svg", "list_names"])
    .optional()
    .default("circuit_json")
    .describe("What to return: circuit json (default), svg preview, or the list of supported names."),
}

export const generateFootprint: ToolCallback<typeof footprintInput> = {
  name: "tscircuit_generate_footprint",
  title: "Generate footprint from string",
  description:
    "Generate a PCB footprint using the tscircuit footprinter DSL. Footprint strings encode package " +
    "parameters, e.g. 'soic8', 'qfp48', 'qfn16', 'bga32', '0402', 'pinrow4_p2.54mm', 'tssop20', " +
    "'sod323', 'led1608'. Returns the footprint as CircuitJson (pads, silkscreen, courtyard) or a " +
    "PCB SVG preview. Use output='list_names' to list all supported footprint names.",
  inputSchema: footprintInput,
  annotations: { readOnlyHint: false },

  async execute({ footprint_string, output }, session = getSession()) {
    if (output === "list_names") {
      const names = getFootprintNames()
      return {
        content: [
          {
            type: "text" as const,
            text: `# Supported footprint names (${names.length})\n\n` + names.join(", "),
          },
        ],
      }
    }

    let circuitJson
    try {
      circuitJson = fp.string(footprint_string).circuitJson()
    } catch (err: any) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Failed to build footprint "${footprint_string}": ${String(err?.message ?? err)}\n\n` +
              "Call with output='list_names' to see supported names.",
          },
        ],
        isError: true,
      }
    }

    if (output === "svg") {
      const svg = convertCircuitJsonToPcbSvg(circuitJson)
      const path = writeArtifact(session, {
        kind: "footprint_svg",
        ext: "svg",
        base: `fp-${footprint_string.replace(/[^a-z0-9-]/gi, "_")}`,
        data: svg,
      })
      return {
        content: [{ type: "text" as const, text: `Footprint "${footprint_string}" SVG saved to: ${path}` }],
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text:
            `# Footprint "${footprint_string}"\n\n${circuitJson.length} elements:\n\n` +
            "```json\n" +
            JSON.stringify(circuitJson, null, 2).slice(0, 60_000) +
            "\n```",
        },
      ],
    }
  },
}
