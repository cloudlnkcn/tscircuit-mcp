// Probe: which endpoints does CircuitRunner hit when resolving @tsci imports?
import http from "node:http"
import { CircuitRunner } from "@tscircuit/eval"

const hits = []
const srv = http.createServer((req, res) => {
  hits.push(`${req.method} ${req.url}`)
  // serve plausible not-found JSON so eval fails fast but after the request
  res.writeHead(200, { "content-type": "application/json" })
  res.end(JSON.stringify({ ok: false, error: { message: "probe: not found" } }))
})
await new Promise((r) => srv.listen(0, "127.0.0.1", r))
const port = srv.address().port
const base = `http://127.0.0.1:${port}`

const code = `
import { BlinkingLED } from "@tsci/Rishikesh63.BlinkingLED-Circuit-sample"
export default () => (
  <board width="30mm" height="30mm"><BlinkingLED name="X" /></board>
)
`

const runner = new CircuitRunner({
  snippetsApiBaseUrl: base,
  cjsRegistryUrl: base,
})
try {
  await runner.execute(code)
  await runner.renderUntilSettled()
} catch (e) {
  console.log("eval stopped:", String(e.message).slice(0, 160))
}
await new Promise((r) => setTimeout(r, 1500))
runner.kill().catch(() => {})
console.log("captured requests to probe server:")
console.log([...new Set(hits)].join("\n") || "(none)")
srv.close()
process.exit(0)
