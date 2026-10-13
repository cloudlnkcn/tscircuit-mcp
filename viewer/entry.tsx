import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { PCBViewer } from "@tscircuit/pcb-viewer"
import { SchematicViewer } from "@tscircuit/schematic-viewer"

/**
 * Browser entry for the interactive viewers served at /viewer.
 * Query params:
 *   ?file=/files/<name>.circuit.json   CircuitJson to render
 *   ?type=pcb (default) | schematic    which viewer to render with
 */
async function main() {
  const params = new URLSearchParams(window.location.search)
  const file = params.get("file") ?? "/files/latest.circuit.json"
  const type = params.get("type") === "schematic" ? "schematic" : "pcb"
  const status = document.getElementById("status")!

  try {
    const res = await fetch(file, { headers: { accept: "application/json" } })
    if (!res.ok) throw new Error(`failed to load ${file} (${res.status})`)
    const circuitJson = await res.json()
    if (!Array.isArray(circuitJson) || circuitJson.length === 0) {
      throw new Error("not a CircuitJson array")
    }
    status.textContent = `${circuitJson.length} elements loaded · ${type} view`

    // pcb-viewer defaults to WebGPU; probe for a real adapter and fall back
    // to canvas2d when unavailable (headless browsers, Firefox, Safari).
    const useWebGPU = await (async () => {
      try {
        const gpu = (navigator as any).gpu
        if (!gpu) return false
        return !!(await gpu.requestAdapter())
      } catch {
        return false
      }
    })()

    const viewerProps: Record<string, unknown> =
      type === "schematic"
        ? { circuitJson, showSchematicPorts: true, searchEnabled: true }
        : useWebGPU
          ? { circuitJson }
          : { circuitJson, renderer: "canvas" }
    const Viewer: any = type === "schematic" ? SchematicViewer : PCBViewer

    const root = createRoot(document.getElementById("root")!)
    root.render(
      createElement(
        "div",
        {
          style: {
            width: "100vw",
            height: "100vh",
            backgroundColor: type === "schematic" ? "#f5f1ed" : "#000",
          },
        },
        createElement(Viewer, viewerProps),
      ),
    )
  } catch (err: any) {
    status.textContent = `Error: ${String(err?.message ?? err)}`
    status.style.color = "#ff6b6b"
  }
}

main()
