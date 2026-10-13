import { z } from "zod"
import { runAllChecks } from "@tscircuit/checks"
import type { ToolCallback } from "../types.js"
import { resolveCircuitJson } from "../types.js"
import type { AnyCircuitElement } from "circuit-json"

const inputSchema = {
  circuit_json: z
    .unknown()
    .optional()
    .describe(
      "Optional explicit CircuitJson array to check. If omitted, uses the circuit from the last tscircuit_eval in this session.",
    ),
}

interface Finding {
  type?: string
  error_type?: string
  message?: string
  [k: string]: unknown
}

export const checkCircuit: ToolCallback<typeof inputSchema> = {
  name: "tscircuit_check_circuit",
  title: "Run DRC / connectivity checks",
  description:
    "Run all tscircuit design-rule and connectivity checks against a circuit: placement, routing, " +
    "clearance, courtyard overlap, pin specification, schematic checks, unconnected ports, etc. " +
    "Uses the session circuit unless circuit_json is given.",
  inputSchema,
  annotations: { readOnlyHint: true },

  async execute({ circuit_json }, session) {
    const cj = resolveCircuitJson(session, circuit_json as AnyCircuitElement[])
    const findings = (await runAllChecks(cj as any)) as Finding[]

    const errors = findings.filter(
      (f) => (f.type ?? "").endsWith("_error") || (f.error_type ?? "").endsWith("_error"),
    )
    const warnings = findings.filter(
      (f) => (f.type ?? "").endsWith("_warning") || (f.error_type ?? "").endsWith("_warning"),
    )

    const lines = [
      `# Check results: ${errors.length} error(s), ${warnings.length} warning(s)`,
    ]
    if (errors.length) {
      lines.push("\n## Errors")
      for (const e of errors.slice(0, 50)) lines.push(`- [${e.type ?? e.error_type}] ${e.message ?? compact(e)}`)
    }
    if (warnings.length) {
      lines.push("\n## Warnings")
      for (const w of warnings.slice(0, 50)) lines.push(`- [${w.type ?? w.error_type}] ${w.message ?? compact(w)}`)
    }
    if (!errors.length && !warnings.length) lines.push("\nNo issues found — circuit passes all checks.")

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      structuredContent: {
        error_count: errors.length,
        warning_count: warnings.length,
        errors: errors.slice(0, 100),
        warnings: warnings.slice(0, 100),
      },
    }
  },
}

function compact(f: Finding): string {
  // stringify without the redundant type/message fields (undefined is dropped)
  return JSON.stringify({ ...f, type: undefined, error_type: undefined, message: undefined }).slice(0, 200)
}
