import type { ToolCallback } from "../types.js"
import { evalCircuit } from "./eval-circuit.js"
import { checkCircuit } from "./check-circuit.js"
import { renderSchematicSvg, renderPcbSvg, renderAssemblySvg } from "./render.js"
import { exportGltf, exportPnpCsv, exportBomCsv, getCircuitJson } from "./export.js"
import { searchComponents, getComponent } from "./registry.js"
import { generateFootprint } from "./footprint.js"
import { createProject } from "./create-project.js"
import { prefetchComponents, registryCacheStatus } from "./prefetch.js"
import { previewKicadFootprint } from "./kicad-footprint.js"
import { listElements, getElementDocs } from "./elements.js"

/** All tools this server exposes. */
export const allTools: ToolCallback<any>[] = [
  evalCircuit,
  checkCircuit,
  renderSchematicSvg,
  renderPcbSvg,
  renderAssemblySvg,
  exportGltf,
  exportPnpCsv,
  exportBomCsv,
  getCircuitJson,
  searchComponents,
  getComponent,
  generateFootprint,
  createProject,
  prefetchComponents,
  registryCacheStatus,
  previewKicadFootprint,
  listElements,
  getElementDocs,
]
