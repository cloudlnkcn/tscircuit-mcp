#!/usr/bin/env node
// End-to-end test of the MCP server over Streamable HTTP.
const BASE = process.env.BASE ?? "http://127.0.0.1:3777"

let sessionId = null
let nextId = 1

async function rpc(method, params, { notification = false } = {}) {
  const headers = {
    "content-type": "application/json",
    accept: notification ? "application/json" : "application/json, text/event-stream",
  }
  if (sessionId) headers["mcp-session-id"] = sessionId
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(
      notification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: nextId++, method, params },
    ),
  })
  const sid = res.headers.get("mcp-session-id")
  if (sid) sessionId = sid
  const ct = res.headers.get("content-type") ?? ""
  if (!notification) {
    if (ct.includes("text/event-stream")) {
      const text = await res.text()
      for (const line of text.split("\n")) {
        if (line.startsWith("data:")) return JSON.parse(line.slice(5).trim())
      }
      throw new Error("no data in SSE: " + text.slice(0, 300))
    }
    return res.json()
  }
  return null
}

const results = []
function check(name, cond, detail = "") {
  results.push({ name, pass: !!cond, detail })
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`)
}

// 1. initialize
const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "e2e-test", version: "0.0.1" },
})
check("initialize", init?.result?.serverInfo?.name === "tscircuit-mcp", `server=${init?.result?.serverInfo?.name}, proto=${init?.result?.protocolVersion}`)
check("session id header", !!sessionId, sessionId)

// 2. initialized notification
await rpc("notifications/initialized", {}, { notification: true })

// 3. tools/list
const tools = await rpc("tools/list", {})
const toolNames = (tools?.result?.tools ?? []).map((t) => t.name)
check(
  "tools/list has all 18 tools",
  [
    "tscircuit_eval",
    "tscircuit_check_circuit",
    "tscircuit_render_schematic_svg",
    "tscircuit_render_pcb_svg",
    "tscircuit_render_assembly_svg",
    "tscircuit_export_gltf",
    "tscircuit_export_pnp_csv",
    "tscircuit_export_bom_csv",
    "tscircuit_get_circuit_json",
    "tscircuit_search_components",
    "tscircuit_get_component",
    "tscircuit_generate_footprint",
    "tscircuit_create_project",
    "tscircuit_prefetch_components",
    "tscircuit_registry_cache_status",
    "tscircuit_list_elements",
    "tscircuit_get_element_docs",
  ].every((n) => toolNames.includes(n)),
  toolNames.join(","),
)

// 4. resources/list
const resources = await rpc("resources/list", {})
const resUris = (resources?.result?.resources ?? []).map((r) => r.uri)
check(
  "resources/list",
  ["tscircuit://docs/api-reference", "tscircuit://docs/examples", "tscircuit://session/summary", "tscircuit://session/artifacts"].every(
    (u) => resUris.includes(u),
  ),
  resUris.join(","),
)

// 5. resources/read api-reference
const apiRef = await rpc("resources/read", { uri: "tscircuit://docs/api-reference" })
check("resources/read api-reference", (apiRef?.result?.contents?.[0]?.text ?? "").includes("<board"), "len=" + (apiRef?.result?.contents?.[0]?.text ?? "").length)

// 6. prompts/list
const prompts = await rpc("prompts/list", {})
check("prompts/list", (prompts?.result?.prompts ?? []).length >= 2, prompts?.result?.prompts?.map((p) => p.name).join(","))

// 7. tools/call tscircuit_eval (real circuit)
const evalCode = `export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="10k" footprint="0402" pcbX={-3} />
    <capacitor name="C1" capacitance="100nF" footprint="0402" pcbX={3} />
    <trace from=".R1 > .1" to=".C1 > .1" />
  </board>
)`
const t0 = Date.now()
const ev = await rpc("tools/call", { name: "tscircuit_eval", arguments: { code: evalCode } })
const evText = ev?.result?.content?.[0]?.text ?? ""
check("tools/call tscircuit_eval", ev?.result?.isError !== true && evText.includes("Circuit evaluated OK"), `took ${Date.now() - t0}ms`)
check("eval summary has components", evText.includes("R1") && evText.includes("C1"), "")

// 8. session chaining: render pcb svg without circuit_json
const pcb = await rpc("tools/call", { name: "tscircuit_render_pcb_svg", arguments: {} })
const pcbItems = pcb?.result?.content ?? []
const pcbImg = pcbItems.find((i) => i.type === "image")
const pcbText = pcbItems.find((i) => i.type === "text")?.text ?? ""
check("render returns inline PNG image content", !!pcbImg && pcbImg.mimeType === "image/png", pcbImg ? `${Math.round((pcbImg.data.length * 3) / 4 / 1024)}KB png` : "no image")
check("tools/call render_pcb_svg (session chain)", !pcb?.result?.isError && pcbText.includes(".svg"), (pcbText.match(/Saved to: (.*)/) ?? [])[1] ?? pcbText.slice(0, 120))

// 8b. preview endpoints (/view HTML page, /files raw asset, /files index)
const pcbViewerUrl = (pcbText.match(/Interactive PCB viewer[^:]*: (http\S+)/) ?? [])[1]
const pcbViewUrl = (pcbText.match(/Static preview page: (http\S+)/) ?? [])[1]
if (pcbViewUrl) {
  const rv = await fetch(pcbViewUrl)
  const bv = await rv.text()
  check("GET /view/<svg> HTML preview page (pan/zoom)", rv.status === 200 && bv.includes("pz-inner"), pcbViewUrl)
  const rint = await fetch(pcbViewerUrl)
  const bint = await rint.text()
  check("GET /viewer interactive PCB page", rint.status === 200 && bint.includes("/assets/viewer.js"), pcbViewerUrl)
  const fileUrl = (pcbText.match(/Direct file URL: (http\S+)/) ?? [])[1]
  const rf = await fetch(fileUrl)
  check("GET /files/<svg> raw asset", rf.status === 200 && (rf.headers.get("content-type") ?? "").includes("image/svg+xml"), `${rf.status} ${rf.headers.get("content-type")}`)
  const jsonFile = (pcbViewerUrl ?? "").match(/file=(%2Ffiles%2F[\w.%-]+)/)?.[1]
  if (jsonFile) {
    const rj = await fetch(`${BASE}${decodeURIComponent(jsonFile)}`)
    const jd = await rj.json().catch(() => null)
    check("GET /files/<x>.circuit.json (viewer data)", rj.status === 200 && Array.isArray(jd) && jd.length > 0, `${jd?.length ?? 0} elements`)
  } else {
    check("GET /files/<x>.circuit.json (viewer data)", false, "no circuit.json param in viewer URL")
  }
} else {
  check("GET /view/<svg> HTML preview page", false, "no preview URL in tool result")
}
const glPreview = await rpc("tools/call", { name: "tscircuit_export_gltf", arguments: { format: "glb" } })
const glViewUrl = (/Interactive 3D preview \(orbit\/zoom\): (http\S+)/.exec(glPreview?.result?.content?.[0]?.text ?? "") ?? [])[1]
if (glViewUrl) {
  const r3 = await fetch(glViewUrl)
  const b3 = await r3.text()
  check("GET /view/<glb> 3D model-viewer page", r3.status === 200 && b3.includes("model-viewer"), glViewUrl)
} else {
  check("GET /view/<glb> 3D model-viewer page", false, "no 3D preview URL in tool result")
}
const filesIdx = await (await fetch(`${BASE}/files`)).json()
check("GET /files artifact index", filesIdx.count >= 3 && Array.isArray(filesIdx.files), `${filesIdx.count} artifacts`)

const sch = await rpc("tools/call", { name: "tscircuit_render_schematic_svg", arguments: {} })
check("tools/call render_schematic_svg", !(sch?.result?.isError === true), (sch?.result?.content?.[0]?.text ?? "").slice(0, 100))

// 9. check circuit
const chk = await rpc("tools/call", { name: "tscircuit_check_circuit", arguments: {} })
const chkText = chk?.result?.content?.[0]?.text ?? ""
check("tools/call check_circuit", !chk?.result?.isError && chkText.includes("Check results"), chkText.split("\n")[0] ?? "")

// 10. BOM + PnP
const bom = await rpc("tools/call", { name: "tscircuit_export_bom_csv", arguments: {} })
check("tools/call export_bom_csv", !(bom?.result?.isError === true), (bom?.result?.content?.[0]?.text ?? "").split("\n")[0])
const pnp = await rpc("tools/call", { name: "tscircuit_export_pnp_csv", arguments: {} })
check("tools/call export_pnp_csv", !(pnp?.result?.isError === true), (pnp?.result?.content?.[0]?.text ?? "").split("\n")[0])

// 11. circuit json
const cj = await rpc("tools/call", { name: "tscircuit_get_circuit_json", arguments: { element_type: "pcb_trace" } })
check("tools/call get_circuit_json filtered", !(cj?.result?.isError === true) && (cj?.result?.content?.[0]?.text ?? "").includes("pcb_trace"), "")

// 12. footprint
const fp = await rpc("tools/call", { name: "tscircuit_generate_footprint", arguments: { footprint_string: "soic8", output: "circuit_json" } })
check("tools/call generate_footprint", !(fp?.result?.isError === true) && (fp?.result?.content?.[0]?.text ?? "").includes("pcb_smtpad"), (fp?.result?.content?.[0]?.text ?? "").split("\n")[0])

// 12b. kicad footprint preview -> interactive viewer
const kicadMod = `(module SOP-8 (layer F.Cu) (attr smd) (pad 1 smd rect (at -2.7 -1.905) (size 1.5 0.6) (layers F.Cu F.Paste F.Mask)) (pad 2 smd rect (at 2.7 -1.905) (size 1.5 0.6) (layers F.Cu F.Paste F.Mask)))`
const kp = await rpc("tools/call", { name: "tscircuit_preview_kicad_footprint", arguments: { footprint_source: kicadMod, filename: "SOP-8.kicad_mod" } })
const ktxt = kp?.result?.content?.[0]?.text ?? ""
check("tools/call preview_kicad_footprint", !(kp?.result?.isError === true) && ktxt.includes("Interactive viewer"), (ktxt.match(/\((\d+) elements\)/) ?? [])[0] ?? "")

// 13. registry search (network)
try {
  const sr = await rpc("tools/call", { name: "tscircuit_search_components", arguments: { query: "esp32", limit: 3 } })
  check("tools/call search_components", !(sr?.result?.isError === true), ((sr?.result?.content?.[0]?.text ?? "").match(/Registry results.*/) ?? [""])[0].slice(0, 60))
} catch (e) {
  check("tools/call search_components", false, String(e).slice(0, 80))
}

// 14. error path: bad code
const bad = await rpc("tools/call", { name: "tscircuit_eval", arguments: { code: "export default () => <board><not_a_real_component /></board>" } })
check("eval error path returns isError", bad?.result?.isError === true, ((bad?.result?.content?.[0]?.text ?? "").match(/Error:[^\n]*/) ?? [""])[0].slice(0, 100))

// 15. tool error without session circuit (fresh state check via get_circuit_json would error)
const noCircuit = await rpc("tools/call", { name: "tscircuit_get_circuit_json", arguments: {} })
check("tool failure wrapped as JSON-RPC result (not transport error)", noCircuit !== null && (noCircuit?.result?.isError === true || (noCircuit?.result?.content?.[0]?.text ?? "").length > 0), (noCircuit?.result?.content?.[0]?.text ?? "").slice(0, 80))

// 16. create project
import { mkdtempSync } from "node:fs"
const tmp = mkdtempSync("/tmp/tsci-proj-")
const proj = await rpc("tools/call", { name: "tscircuit_create_project", arguments: { directory: tmp } })
check("tools/call create_project", !(proj?.result?.isError === true) && (proj?.result?.content?.[0]?.text ?? "").includes("Files:"), tmp)

// 17. DELETE session
const del = await fetch(`${BASE}/mcp`, { method: "DELETE", headers: { "mcp-session-id": sessionId } })
check("DELETE /mcp terminates session", del.status === 200 || del.status === 204, "status=" + del.status)

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed`)
if (results.some((r) => !r.pass)) process.exit(1)
