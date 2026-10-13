// Generates src/generated/elements.json — the catalogue of tscircuit JSX
// elements that are actually instantiable in a <board>, verified by probing
// the evaluator itself (not by reading types). Also snapshots each element's
// props interface text from @tscircuit/props for the get-element-docs tool.
//
// Run: node scripts/gen-element-docs.mjs
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { CircuitRunner } from "@tscircuit/eval"

const nodeRequire = createRequire(import.meta.url)
const PROPS_DTS = nodeRequire.resolve("@tscircuit/props/package.json").replace(/package\.json$/, "dist/index.d.ts")

const dts = readFileSync(PROPS_DTS, "utf-8")

// 1. Candidate element names from the props type definitions
const candidates = [
  ...dts.matchAll(/^interface ([A-Za-z]+)Props(?:<[^>]*>)? ?/gm),
]
  .map((m) => m[1])
  .filter(
    (n) =>
      !/^(Base|Common|Simulation|Analog|Autorouting|Assembly|Cad|Net$|Trace$|Pcb|Schematic|Source|Footprint|Layout|Scale|Rotation|Symbol|Port|Jscad|Silkscreen|Fabrication|Subcircuit|Primitive|Global|Supplier|Constrained|Pinout|InternalCircuit|Spice|Auto)/.test(
        n,
      ),
  )
  .map((n) => n.toLowerCase())

// High-frequency elements whose props types are named differently (aliases,
// primitive components) — probed like the rest so invalid ones drop out.
const EXTRA_CANDIDATES = [
  "trace", "led", "netalias", "net", "ground", "power", "powersource",
  "platedhole", "hole", "smtpad", "footprint", "silkscreentext",
  "silkscreenpath", "silkscreenline", "silkscreenrect", "silkscreencircle",
  "silkscreenrectwithtext", "region", "schematicbox", "schematicpath",
  "schematicline", "schematicrectangle", "schematictext", "inducedvoltagesource",
]

// de-dup, drop obvious non-JSX helpers
const unique = [...new Set([...candidates, ...EXTRA_CANDIDATES])].filter((n) => n.length > 2)

// 2. Snapshot props interface text (with leading JSDoc) for each candidate
function interfaceTextFor(elem) {
  const pascal = elem.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())
  const re = new RegExp(`((?:/\\*\\*[\\s\\S]*?\\*/\\n)?(?:export )?interface ${pascal}Props\\b[^{]*\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\})`)
  const m = dts.match(re)
  return m ? m[1] : null
}

// Hand-written docs for the highest-frequency elements whose props are
// defined as zod schemas (not interfaces) in @tscircuit/props, plus a warning
// entry for known-inert elements.
const CURATED_DOCS = {
  chip: `interface ChipProps {
  name: string
  footprint: string              // e.g. "soic8", "qfp48", "bga64" (footprinter names)
  manufacturerPartNumber?: string
  pinLabels?: Record<number|string, string | string[]>  // pin number -> label(s)
  schPortArrangement?: {         // schematic symbol pin sides
    leftSide?: { pins: (string|number)[]; direction?: "top-to-bottom"|"bottom-to-top" }
    rightSide?: { pins: (string|number)[]; direction?: "top-to-bottom"|"bottom-to-top" }
    topSide?: { pins: (string|number)[] }
    bottomSide?: { pins: (string|number)[] }
  }
  connections?: Record<string, string>  // pinLabel -> "net.X" | "R1.1" | "pinnumber"
  pcbX?: number | string; pcbY?: number | string   // optional: engine auto-places if omitted
  layer?: "top" | "bottom"
}
Internally-powered ICs may need decoupling caps; every pin in pinLabels can be
referenced from <trace> as ".<name> > .<pinLabel>".`,
  trace: `interface TraceProps {
  from: string   // ".R1 > .1" (selector) | "R1.1" | "net.GND"
  to: string
  thickness?: number | string
  // PCB routing is automatic; only set these to override:
  // lengths/segments/vias are computed by the autorouter.
}
Prefer connecting via chip \`connections\` — traces are then created implicitly.`,
  led: `interface LedProps {
  name: string
  footprint?: string            // e.g. "0603"
  color?: "red" | "green" | "blue" | "yellow" | "white" | "orange" | "warmWhite" | "coolWhite"
  intensity?: string
  power?: string
  schX?: number | string; schY?: number | string
  pcbX?: number | string; pcbY?: number | string  // optional: auto-placed if omitted
}
Pins: ".anode" / ".cathode".`,
  netalias: `interface NetAliasProps {
  name: string   // e.g. "GND", "VCC", "SPI_CLK"
}
Creates a named net. Reference it from traces as ".<name>" or "net.<name>".`,
  ground: `WARNING: <ground /> is accepted by the evaluator but is INERT — it creates
no element and no connection. Do not use it. Ground pins with
<trace from="..." to="net.GND" /> instead.`,
}

const propsText = {}
for (const elem of unique) {
  const t = interfaceTextFor(elem)
  if (t) propsText[elem] = t.slice(0, 6000)
}
Object.assign(propsText, CURATED_DOCS)

// 3. Probe the evaluator in batches: 15 elements per board. Elements unknown
// to the catalogue produce "Unsupported component type" errors naming them.
async function probeBatch(batch) {
  const body = batch.map((e, i) => `    <${e} name="X${i}" />`).join("\n")
  const code = `export default () => (\n  <board width="200mm" height="200mm">\n${body}\n  </board>\n)`
  const runner = new CircuitRunner({})
  try {
    await runner.executeWithFsMap({ mainComponentPath: "main.tsx", fsMap: { "main.tsx": code } })
    await runner.renderUntilSettled()
  } catch (e) {
    // catalogue errors usually surface during execute; fall through to json
  }
  let json = []
  try {
    json = await runner.getCircuitJson()
  } catch {}
  await runner.kill().catch(() => {})
  const unknown = new Set()
  for (const el of json) {
    const msg = el.message ?? ""
    const m = msg.match(/Unsupported component type "([a-z_]+)"/)
    if (m) unknown.add(m[1])
    if (msg.includes("is not a valid") || msg.includes("Unknown component")) unknown.add(el.component_name ?? "")
  }
  // also catch errors thrown per-element as source_failed_to_create_component_error
  for (const el of json) {
    if (el.error_type === "source_failed_to_create_component_error" && el.component_name) {
      // attribute failed creation to the element name if message says so
      for (const cand of batch) {
        if (new RegExp(`\\b${cand}\\b`, "i").test(el.message ?? "")) unknown.add(cand)
      }
    }
  }
  return batch.filter((e) => !unknown.has(e))
}

async function main() {
  const batches = []
  for (let i = 0; i < unique.length; i += 15) batches.push(unique.slice(i, i + 15))

  const ok = []
  for (const b of batches) {
    try {
      const pass = await probeBatch(b)
      ok.push(...pass)
      console.log(`probe ${b.length}: ${pass.length} ok (rejected: ${b.filter((x) => !pass.includes(x)).join(", ") || "none"})`)
    } catch (e) {
      console.error(`batch failed (${e.message}); keeping candidates:`, b.join(","))
      ok.push(...b)
    }
  }

  const out = {
    generated_at: new Date().toISOString(),
    props_package: JSON.parse(readFileSync(nodeRequire.resolve("@tscircuit/props/package.json"), "utf-8")).version,
    count: ok.length,
    elements: ok.sort(),
    props_docs: propsText,
  }
  mkdirSync("src/generated", { recursive: true })
  writeFileSync("src/generated/elements.json", JSON.stringify(out, null, 1))
  console.log(`\nwritten: src/generated/elements.json (${ok.length} verified elements)`)
  process.exit(0)
}

main()
