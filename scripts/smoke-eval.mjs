// Quick smoke test: can runTscircuitCode run in plain Node?
import { runTscircuitCode } from "@tscircuit/eval"

const code = `
export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="10k" footprint="0402" pcbX={-3} />
    <capacitor name="C1" capacitance="100nF" footprint="0402" pcbX={3} />
    <trace from=".R1 > .1" to=".C1 > .1" />
  </board>
)
`

const t0 = Date.now()
try {
  const circuitJson = await runTscircuitCode(code)
  console.log("OK in", Date.now() - t0, "ms, elements:", circuitJson.length)
  const types = {}
  for (const el of circuitJson) types[el.type] = (types[el.type] || 0) + 1
  console.log("element types:", types)
  const errs = circuitJson.filter((e) => e.type?.endsWith("_error"))
  console.log("embedded errors:", errs.length, errs.map((e) => e.message))
} catch (e) {
  console.error("THREW:", e.message?.slice(0, 500))
  process.exit(1)
}
