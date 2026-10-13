import type { AnyCircuitElement } from "circuit-json"

export interface CircuitSummary {
  ok: boolean
  element_count: number
  element_types: Record<string, number>
  components: {
    name: string
    type: string
    footprint?: string
    pin_count?: number
  }[]
  nets: string[]
  board?: { width?: number; height?: number }
  errors: string[]
  warnings: string[]
  stats: {
    pcb_traces: number
    schematic_traces: number
    pcb_vias: number
    pcb_pads: number
    simulation_experiments: number
  }
}

/**
 * Build a compact, LLM-friendly summary of a CircuitJson array.
 * Runtime errors embedded by the evaluator are surfaced in `errors`.
 */
export function summarizeCircuitJson(circuitJson: AnyCircuitElement[]): CircuitSummary {
  const types: Record<string, number> = {}
  const components: CircuitSummary["components"] = []
  const nets = new Set<string>()
  const errors: string[] = []
  const warnings: string[] = []
  let board: CircuitSummary["board"]

  for (const el of circuitJson) {
    const t = (el as { type?: string }).type ?? "unknown"
    types[t] = (types[t] ?? 0) + 1

    const anyEl = el as Record<string, any>

    if (t.endsWith("_error")) {
      errors.push(anyEl.message ?? JSON.stringify(el).slice(0, 300))
    } else if (t.endsWith("_warning")) {
      warnings.push(anyEl.message ?? JSON.stringify(el).slice(0, 300))
    }

    if (t === "source_component") {
      components.push({
        name: anyEl.name ?? anyEl.reference_designator ?? "(unnamed)",
        type: anyEl.ftype ?? anyEl.component_type ?? "component",
        footprint: anyEl.filename?.split("/").pop() ?? undefined,
        pin_count: anyEl.pin_count,
      })
    }
    if (t === "source_net") {
      if (anyEl.name) nets.add(anyEl.name)
    }
    if (t === "pcb_board") {
      board = {
        width: anyEl.width,
        height: anyEl.height,
      }
    }
  }

  return {
    ok: errors.length === 0,
    element_count: circuitJson.length,
    element_types: types,
    components,
    nets: [...nets].sort(),
    board,
    errors,
    warnings,
    stats: {
      pcb_traces: types["pcb_trace"] ?? 0,
      schematic_traces: types["schematic_trace"] ?? 0,
      pcb_vias: types["pcb_via"] ?? 0,
      pcb_pads: (types["pcb_smtpad"] ?? 0) + (types["pcb_plated_hole"] ?? 0),
      simulation_experiments: types["simulation_experiment"] ?? 0,
    },
  }
}
