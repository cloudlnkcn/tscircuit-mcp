import { z } from "zod"
import elementsJson from "../generated/elements.json"
import type { ToolCallback } from "../types.js"

interface ElementsDb {
  generated_at: string
  props_package: string
  count: number
  elements: string[]
  props_docs: Record<string, string>
}

const elementDb = elementsJson as ElementsDb

const GROUPS: Record<string, { label: string; examples: string[] }> = {
  "Basic components": { label: "Basic components", examples: ["board", "chip", "resistor", "capacitor", "inductor", "diode", "led", "transistor", "mosfet", "potentiometer", "crystal", "resonator", "fuse", "switch", "battery", "opamp", "antenna", "ammeter", "testpoint", "fiducial"] },
  "Power & sources": { label: "Power & sources", examples: ["voltagesource", "currentsource", "powersource", "power"] },
  "Connectivity": { label: "Connectivity", examples: ["trace", "netalias", "netlabel", "net", "bus", "differentialpair", "copperpour", "via"] },
  "Connectors & mechanical": { label: "Connectors & mechanical", examples: ["connector", "interconnect", "jumper", "solderjumper", "pinheader", "breakout", "breakoutpoint", "fanout", "mountedboard", "panel", "subpanel", "stampboard", "enclosurefdmbox"] },
  "Footprint primitives": { label: "Footprint primitives (inside <footprint>)", examples: ["footprint", "smtpad", "platedhole", "hole", "circleshape", "rectshape", "pillshape", "silkscreentext", "silkscreenpath", "silkscreenline", "silkscreenrect", "silkscreencircle", "cutoutaperture", "circlecutout", "rectcutout", "polygoncutout", "toolingrail"] },
  "Subcircuits & layout": { label: "Subcircuits & layout", examples: ["subcircuitgroup", "nonsubcircuitgroup", "group"] },
}

function groupOf(elem: string): string {
  for (const g of Object.values(GROUPS)) {
    for (const ex of g.examples) {
      if (elem === ex || elem.startsWith(ex)) return g.label
    }
  }
  return "Other"
}

const listInput = {
  filter: z.string().optional().describe("Only show elements containing this substring."),
}

export const listElements: ToolCallback<typeof listInput> = {
  name: "tscircuit_list_elements",
  title: "List valid tscircuit elements",
  description:
    "List every JSX element that is verified instantiable inside a <board> in this server's tscircuit " +
    "version (probed against the real evaluator). Use this instead of guessing element names — " +
    "note there is NO <ground> element; ground with to=\"net.GND\". " +
    "Layout tip: pcbX/pcbY/schX/schY are OPTIONAL — omit them and the engine auto-places and auto-routes.",
  inputSchema: listInput,
  annotations: { readOnlyHint: true },

  async execute({ filter }) {
    const d = elementDb
    let elems = d.elements
    if (filter) {
      const f = filter.toLowerCase()
      elems = elems.filter((e) => e.includes(f))
    }
    const grouped = new Map<string, string[]>()
    for (const e of elems) {
      const g = groupOf(e)
      if (!grouped.has(g)) grouped.set(g, [])
      grouped.get(g)!.push(e)
    }
    const hasDoc = (e: string) => (d.props_docs[e] ? " 📄" : "")
    const lines = [
      `# Valid tscircuit elements (${elems.length}${filter ? ` matching "${filter}"` : ""} of ${d.count})`,
      "",
      `Verified against @tscircuit/props ${d.props_package} at ${d.generated_at}. 📄 = props docs available via tscircuit_get_element_docs.`,
      "",
      "**Layout**: do NOT hand-write pcbX/pcbY/schX/schY unless you have a specific placement in mind —",
      "the engine auto-places components and auto-routes traces when coordinates are omitted.",
      "",
    ]
    for (const [g, list] of grouped) {
      lines.push(`## ${g}`)
      lines.push(list.map((e) => `- ${e}${hasDoc(e)}`).join("\n"))
      lines.push("")
    }
    lines.push(
      "**Known-inert elements**: `ground` is accepted but does nothing — ground with `to=\"net.GND\"`.",
    )
    return { content: [{ type: "text" as const, text: lines.join("\n") }] }
  },
}

const docsInput = {
  element: z.string().describe("Element name, e.g. 'resistor', 'chip', 'trace', 'smtpad'."),
}

export const getElementDocs: ToolCallback<typeof docsInput> = {
  name: "tscircuit_get_element_docs",
  title: "Get props documentation for an element",
  description:
    "Get the props (attributes) documentation for a tscircuit element, extracted from the installed " +
    "@tscircuit/props type definitions (plus curated docs for chip/trace/led/net_alias). " +
    "Use tscircuit_list_elements first to see valid names.",
  inputSchema: docsInput,
  annotations: { readOnlyHint: true },

  async execute({ element }) {
    const d = elementDb
    const key = element.toLowerCase().replace(/^</, "").replace(/>$/, "").replace(/-|_/, (m) => m)
    const doc = d.props_docs[element.toLowerCase()] ?? d.props_docs[key]
    if (!doc) {
      const similar = d.elements.filter((e) => e.includes(element.toLowerCase().slice(0, 4))).slice(0, 8)
      return {
        content: [
          {
            type: "text" as const,
            text:
              `No props documentation for "${element}". ` +
              (similar.length ? `Similar elements: ${similar.join(", ")}. ` : "") +
              "Call tscircuit_list_elements to see valid names. " +
              "Common props on all components: name, footprint, pcbX/pcbY (optional — auto-placed), " +
              "schX/schY (optional), layer, rotation, connections.",
          },
        ],
        isError: true,
      }
    }
    return {
      content: [
        {
          type: "text" as const,
          text:
            `# \`${element}\` props\n\n` +
            "Coordinates (pcbX/pcbY, schX/schY) are optional — omit them for automatic placement.\n\n" +
            "```ts\n" +
            doc +
            "\n```",
        },
      ],
    }
  },
}
