import { z } from "zod"
import { CircuitRunner } from "@tscircuit/eval"
import { createRequire } from "node:module"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import type { AnyCircuitElement } from "circuit-json"
import type { ToolCallback } from "../types.js"
import { getSession } from "../lib/circuit-session.js"
import { summarizeCircuitJson } from "../lib/summary.js"
import { startRegistryProxy } from "../lib/registry-proxy.js"

const nodeRequire = createRequire(import.meta.url)

/**
 * Mirror the real `react` package into the evaluator's virtual fsMap so that
 * registry bundles' `require("react")` / `require("react/jsx-runtime")` bind
 * to a single React instance (CDN-served copies create a second React and
 * silently render nothing) — and keep working with no network at all.
 */
// Memoized: the react package tree is static for the process lifetime.
let reactFilesCache: Record<string, string> | null = null
function reactNodeModuleFiles(): Record<string, string> {
  if (reactFilesCache) return reactFilesCache
  const files: Record<string, string> = {}
  const reactEntry = nodeRequire.resolve("react")
  const reactDir = dirname(reactEntry)
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) {
        walk(p)
      } else if (st.isFile() && /\.(js|json)$/.test(name) && st.size < 5_000_000) {
        const key = "node_modules/react/" + relative(reactDir, p).split(sep).join("/")
        files[key] = readFileSync(p, "utf-8")
      }
    }
  }
  walk(reactDir)
  reactFilesCache = files
  return files
}

/**
 * Registry bundles `require("tscircuit")` for helpers like `assembly` and
 * `SOLVERS`. The full aggregate package is too deep to mirror into the fsMap,
 * so expose the real module through a globalThis bridge (evaluator modules run
 * via Function(...).call(globalThis), so they share this global).
 */
const TSCIRCUIT_BRIDGE_KEY = "__TSCIRCUIT_MCP_MODULE_BRIDGE__"

function tscircuitBridgeFiles(): Record<string, string> {
  ;(globalThis as any)[TSCIRCUIT_BRIDGE_KEY] = nodeRequire("tscircuit")
  return {
    "node_modules/tscircuit/package.json": JSON.stringify({
      name: "tscircuit",
      main: "index.js",
    }),
    "node_modules/tscircuit/index.js":
      `module.exports = new Proxy({}, { get: (_, k) => globalThis[${JSON.stringify(TSCIRCUIT_BRIDGE_KEY)}][k] })`,
  }
}

const inputSchema = {
  code: z
    .string()
    .describe(
      "tscircuit TSX source code. Must export a default component rendering a <board>. " +
        'Example: `export default () => (<board width="20mm" height="20mm"><resistor name="R1" resistance="10k" footprint="0402" /></board>)`',
    ),
  files: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Optional multi-file project map, e.g. { 'main.tsx': \"...\", 'lib/led.tsx': '...' }. " +
        "When provided, `code` is ignored entirely and the entrypoint file (default 'main.tsx') is evaluated; " +
        "relative imports between files work.",
    ),
  entrypoint: z
    .string()
    .optional()
    .describe("Entrypoint path inside `files` (default 'main.tsx')."),
}

export const evalCircuit: ToolCallback<typeof inputSchema> = {
  name: "tscircuit_eval",
  title: "Evaluate tscircuit TSX code",
  description:
    "Evaluate tscircuit TSX/React circuit code and return the compiled CircuitJson summary " +
    "(components, nets, traces, board size) plus compile/runtime errors and warnings. " +
    "The resulting circuit is stored in the session so downstream tools " +
    "(render SVG, export PnP/BOM/3D, DRC check) can be called without re-passing code. " +
    "Registry imports (`@tsci/...`) are fetched automatically over the network.",
  inputSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },

  async execute({ code, files, entrypoint }, session) {
    let circuitJson: AnyCircuitElement[]
    try {
      // Evaluate through the local registry cache-proxy so that `@tsci/*`
      // imports resolve from disk when offline (and get cached when online).
      // Bare npm deps used by bundles (react, tscircuit) are injected into
      // the evaluator's fsMap so they never need the CDN.
      const proxy = await startRegistryProxy()
      const runner = new CircuitRunner({
        cjsRegistryUrl: proxy.cjsUrl,
        snippetsApiBaseUrl: proxy.apiUrl,
      })
      const multiFile = files && Object.keys(files).length > 0
      // NOTE: mainComponentPath must not be "entrypoint.tsx" — the runner
      // writes its synthetic wrapper to that exact path (self-import cycle).
      const mainComponentFile = multiFile ? entrypoint ?? "main.tsx" : "main.tsx"
      const fsMap: Record<string, string> = {
        ...(multiFile ? files : { [mainComponentFile]: code }),
        ...reactNodeModuleFiles(),
        ...tscircuitBridgeFiles(),
      }
      try {
        // Only pass mainComponentPath: the runner then synthesizes an
        // entrypoint that imports the file's default export and circuit.add()s
        // it. Passing `entrypoint` too would skip that wrapping.
        await runner.executeWithFsMap({
          mainComponentPath: mainComponentFile,
          fsMap,
        })
        await runner.renderUntilSettled()
        circuitJson = await runner.getCircuitJson()
      } finally {
        await runner.kill().catch(() => {})
      }
    } catch (err: any) {
      let message = String(err?.message ?? err).slice(0, 4000)
      if (/has no files in dist/.test(message)) {
        message +=
          "\n\nHint: this also happens when the component is not in the local registry cache " +
          "(e.g. offline mode). While online, call `tscircuit_prefetch_components` to cache it, " +
          "or check `tscircuit_registry_cache_status`."
      }
      session.lastDiagnostics = {
        ok: false,
        errors: [message],
        warnings: [],
        element_count: null,
      }
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Circuit evaluation failed.\n\nError:\n${message}\n\n` +
              "Fix the code and call tscircuit_eval again. " +
              "Use the `tscircuit://docs/api-reference` resource for syntax help.",
          },
        ],
        isError: true,
      }
    }

    session.setCircuit(circuitJson, code)
    const summary = summarizeCircuitJson(circuitJson)
    session.lastDiagnostics = {
      ok: summary.ok,
      errors: summary.errors,
      warnings: summary.warnings,
      element_count: summary.element_count,
    }

    const parts = [
      `# Circuit evaluated OK (${summary.element_count} elements)`,
      "",
      "## Summary",
      formatSummaryTable(summary),
    ]
    if (summary.errors.length > 0) {
      parts.push("\n## Embedded errors (circuit rendered but has these issues)")
      summary.errors.forEach((e, i) => parts.push(`${i + 1}. ${e}`))
    }
    if (summary.warnings.length > 0) {
      parts.push("\n## Warnings")
      summary.warnings.slice(0, 20).forEach((w, i) => parts.push(`${i + 1}. ${w}`))
    }
    parts.push(
      "\nCircuit stored in session. Now you can call: tscircuit_check_circuit, " +
        "tscircuit_render_schematic_svg, tscircuit_render_pcb_svg, tscircuit_render_assembly_svg " +
        "(each returns an inline PNG you can see directly, plus interactive preview URLs when over HTTP), " +
        "tscircuit_export_gltf (3D, interactive orbit preview URL), tscircuit_export_pnp_csv, " +
        "tscircuit_export_bom_csv, tscircuit_get_circuit_json.",
    )

    return {
      content: [{ type: "text" as const, text: parts.join("\n") }],
      structuredContent: summary as unknown as Record<string, unknown>,
    }
  },
}

export function formatSummaryTable(summary: ReturnType<typeof summarizeCircuitJson>): string {
  const lines: string[] = []
  if (summary.board) {
    lines.push(
      `- Board: ${summary.board.width ?? "?"}mm x ${summary.board.height ?? "?"}mm`,
    )
  }
  lines.push(
    `- Stats: ${summary.stats.pcb_traces} pcb traces, ${summary.stats.pcb_pads} pads, ` +
      `${summary.stats.pcb_vias} vias, ${summary.stats.schematic_traces} schematic traces`,
  )
  lines.push(`- Nets: ${summary.nets.join(", ") || "(none)"}`)
  lines.push("- Components:")
  for (const c of summary.components) {
    lines.push(
      `  - ${c.name} (${c.type})${c.footprint ? ` [${c.footprint}]` : ""}${
        c.pin_count ? ` ${c.pin_count} pins` : ""
      }`,
    )
  }
  return lines.join("\n")
}
