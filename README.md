# tscircuit-mcp

[English](README.md) | **简体中文**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org/)
[![Protocol](https://img.shields.io/badge/protocol-MCP-7c3aed.svg)](https://modelcontextprotocol.io/)

A **full-featured MCP (Model Context Protocol) Server** built on [tscircuit](https://github.com/tscircuit/tscircuit), letting AI assistants (Claude, Cursor, ZCode, etc.) write, evaluate, check, preview and export PCB circuits directly — from a one-line natural-language description to manufacturable deliverables (BOM / pick-and-place files / 3D models), all within a single session.

Repository: https://github.com/cloudlnkcn/tscircuit-mcp

Supports three transports: **Streamable HTTP** (remote/container deployment), **legacy HTTP+SSE** (older client compatibility), and **stdio** (local clients).

## ✨ Feature Overview

| | Feature | Description |
|---|---|---|
| 🔧 | **18 tools / 4 resources / 2 prompts** | Full pipeline covering evaluation, DRC, rendering, 3D export, manufacturing deliverables, registry search and footprint generation |
| 🖥 | **Interactive PCB viewer** | Bundled [tscircuit/pcb-viewer](https://github.com/tscircuit/pcb-viewer): zoom/pan/hover inspection in the browser, not static screenshots |
| 🖼 | **Inline PNG rendering** | All render tools return PNGs directly in the MCP response — the agent "sees" the result without a second request |
| 📐 | **Automatic layout & routing** | All coordinate props are optional; the engine places components by connectivity, routes PCB traces and arranges schematic symbols automatically |
| 📴 | **Works offline** | Local registry cache proxy: prefetch components while online, keep evaluating while offline — ideal for isolated environments |
| 💬 | **Session-based workflow** | Evaluated circuits persist in the session; render/export/check tools chain together without re-submitting code |
| 🐳 | **One-command Docker deploy** | Image ships the full tscircuit toolchain and the `tsci` CLI; artifacts persisted via volumes, surviving restarts |
| 🔍 | **Verified element catalog** | 95 valid JSX elements, each verified against the real evaluator — prevents agents from using silently-invalid elements |

## 🛠 Tools (18)

### Core evaluation & checking

| Tool | Description |
|---|---|
| `tscircuit_eval` | Evaluate tscircuit TSX circuit code → CircuitJson summary + compile/runtime errors. Supports multi-file `files` maps and automatic registry imports (`@tsci/...`) |
| `tscircuit_check_circuit` | DRC design-rule checks: placement, routing, clearance, courtyard overlap, pin specification, schematic checks, unconnected ports, etc. |

### Rendering & interactive preview

| Tool | Description |
|---|---|
| `tscircuit_render_schematic_svg` | Render a schematic SVG |
| `tscircuit_render_pcb_svg` | Render a PCB layout SVG (dark mode supported) |
| `tscircuit_render_assembly_svg` | Render a 3D-style assembly SVG |
| `tscircuit_preview_kicad_footprint` | KiCad footprint (`.kicad_mod` s-expression) → CircuitJson + interactive viewer URL (the MCP equivalent of the [tscircuit/kicad-viewer](https://github.com/tscircuit/kicad-viewer) app) |

### 3D & manufacturing deliverables

| Tool | Description |
|---|---|
| `tscircuit_export_gltf` | Export a 3D board model (GLB/glTF, with component 3D models); returns an `<model-viewer>` orbit-preview link |
| `tscircuit_export_bom_csv` | Export a bill of materials (BOM CSV: reference designators, descriptions, manufacturer part numbers) |
| `tscircuit_export_pnp_csv` | Export pick-and-place coordinates (PnP CSV: designator, x/y, rotation, layer) |

### Session & data

| Tool | Description |
|---|---|
| `tscircuit_get_circuit_json` | Get the session circuit's CircuitJson (filterable by element type, saveable to disk) |

### Registry & offline cache

| Tool | Description |
|---|---|
| `tscircuit_search_components` | Search the public tscircuit component registry (tscircuit.com) |
| `tscircuit_get_component` | Fetch a registry component's source code and TypeScript definitions |
| `tscircuit_prefetch_components` | **Prefetch registry components into the local cache** (recursively pulls `@tsci/*` dependencies and 3D assets); supports keyword batches; usable offline |
| `tscircuit_registry_cache_status` | Inspect the local component cache (entries/size/location/offline-mode status) |

### Elements & docs

| Tool | Description |
|---|---|
| `tscircuit_list_elements` | **Complete catalog of valid elements** (95, each verified against the real evaluator, not type inference) |
| `tscircuit_get_element_docs` | Look up element props documentation (from @tscircuit/props type definitions + hand-written docs for high-frequency components) |

### Scaffolding & footprints

| Tool | Description |
|---|---|
| `tscircuit_generate_footprint` | Generate footprints with the footprinter DSL (`soic8`, `qfp48`, `pinrow4_p2.54mm`…), outputting CircuitJson or SVG |
| `tscircuit_create_project` | Scaffold a tscircuit project (package.json + tsconfig + gitignore + example circuit) |

Evaluated circuits are stored in the **session**; subsequent render/export/check tools don't need the code re-submitted, enabling chained iterative workflows.

## 🖥 Interactive Preview (a real viewer, not static images)

Bundles [tscircuit/pcb-viewer](https://github.com/tscircuit/pcb-viewer) (React + canvas/WebGPU interactive renderer):

- **`GET /viewer?file=<circuit.json>`** — fullscreen interactive PCB viewer: zoom, pan, hover-inspect pads/traces/designators. Detects WebGPU automatically, falls back to canvas2d when unavailable (headless browsers/Firefox/Safari work too)
- **`GET /view/<x>.circuit.json`** — CircuitJson artifacts redirect to the interactive viewer
- All render tools, besides returning inline PNGs, also persist `<name>.circuit.json` with an **Interactive PCB viewer** link — the agent can relay the interactive preview URL straight to the user
- 3D models: `tscircuit_export_gltf` serves `/view/<x>.glb` with an `<model-viewer>` orbit preview

## 📐 Layout Automation (no hand-written coordinates needed)

The tscircuit engine has built-in automatic layout and routing: **`pcbX`/`pcbY`/`schX`/`schY` are all optional props**. When coordinates are omitted, the engine automatically places components (by connectivity, without overlap), routes PCB traces and arranges schematic symbols. Hand-written coordinates are only needed with explicit layout intent (e.g. decoupling caps close to the MCU).

To make agents follow this convention, the MCP provides three layers of support:

1. The `tscircuit://docs/api-reference` resource and the `create-circuit` prompt both put "auto-layout first" as the prime directive
2. `tscircuit_list_elements` lets the agent confirm valid element names before writing code (avoiding silently-invalid elements like `<ground>` — explicitly warned about in the docs)
3. `tscircuit_get_element_docs` provides each element's props signature — no need to browse online docs

## 📴 Offline-capable (localized registry components)

`@tsci/owner.name` components work offline through a **built-in registry cache proxy**:

- All registry requests during evaluation go through a local proxy (internal `127.0.0.1` port)
- **Online**: requests pass through to upstream and are written to a disk cache (`TSCIRCUIT_MCP_REGISTRY_CACHE`, default `./registry-cache`)
- **Offline** (automatic fallback, or force with `TSCIRCUIT_MCP_OFFLINE=1`): reads directly from cache; uncached components return a clear "not cached" error
- Bare packages required by bundles (`react`, `react/jsx-runtime`) are injected into the evaluator from local node_modules (avoiding silent render failures from dual React instances via CDN); the `tscircuit` package is injected via a globalThis bridge

Offline workflow:

```bash
# 1. Prefetch while online (batch via search: {"query": "esp32", "limit": 10})
#    agent call: tscircuit_prefetch_components {"components": ["rushabhcodes/ESP32-E-Reader"]}

# 2. Keep using it after going offline
#    agent call: tscircuit_eval {"code": "import { EReaderBoard } from \"@tsci/rushabhcodes.ESP32-E-Reader\"\nexport default () => <EReaderBoard name=\"X\" />"}
```

The cache persists via Docker volume `./registry-cache:/data/registry-cache` and survives container restarts/rebuilds.

## 📦 Resources (4)

- `tscircuit://docs/api-reference` — tscircuit TSX syntax cheat sheet (essential for LLM code writing)
- `tscircuit://docs/examples` — example circuits that can be evaluated directly
- `tscircuit://session/summary` — summary of the current session's circuit
- `tscircuit://session/artifacts` — index of artifacts produced this session

## 📝 Prompts (2)

- `create-circuit` — guided workflow from natural-language description to a working circuit
- `review-circuit` — review-and-fix workflow for the session circuit

## 🚀 Quick Start

```bash
git clone https://github.com/cloudlnkcn/tscircuit-mcp.git
cd tscircuit-mcp
npm install
npm run build
```

### Docker Compose (recommended — image ships the full toolchain)

The image builds on `node:22-bookworm-slim` and, besides the MCP Server, comes with the **complete tscircuit toolchain** preinstalled:

- The `tscircuit` aggregate package (global; includes the `tsci` CLI, core, eval, runframe, footprinter, checks and all other official subpackages)
- Component libraries: `@tscircuit/footprinter` (footprints), `schematic-symbols` (schematic symbol library), `@tscircuit/parts-engine` (JLCPCB/EasyEDA parts engine)

```bash
docker compose up -d --build          # build and start, listening on port 3000
curl http://127.0.0.1:3000/health     # {"ok":true,...}

# Client endpoints
#   Streamable HTTP:  http://127.0.0.1:3000/mcp
#   Legacy SSE:       http://127.0.0.1:3000/sse

# Rendered/exported artifacts (SVG/CSV/GLB/JSON) persist on the host at ./output/
docker compose exec tscircuit-mcp tsci --version   # tsci CLI available inside the container

# stdio mode (local clients via docker run -i)
docker compose --profile stdio run --rm tscircuit-mcp-stdio
# or equivalently (must override command explicitly, otherwise HTTP starts by default):
docker run -i --rm tscircuit-mcp:latest node dist/index.js
# Claude Desktop config example:
#   "command": "docker", "args": ["run","-i","--rm","tscircuit-mcp:latest","node","dist/index.js"]
```

### Start the HTTP server (local run)

```bash
# Streamable HTTP, defaults to 0.0.0.0:3000
node dist/index.js --http

# Custom port/host
node dist/index.js --http --port 8080 --host 127.0.0.1
```

Endpoints:

- `POST /mcp` — Streamable HTTP (current MCP spec); sessions maintained via the `mcp-session-id` header
- `GET /mcp` / `DELETE /mcp` — session SSE stream / session termination
- `GET /sse` + `POST /messages` — legacy HTTP+SSE transport (older client compatibility)
- `GET /health` — health check

### stdio mode (Claude Desktop and other local clients)

```bash
node dist/index.js            # stdio by default
```

### Client configuration

**Claude Desktop / Cursor (stdio)** `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tscircuit": {
      "command": "node",
      "args": ["/path/to/tscircuit-mcp/dist/index.js"]
    }
  }
}
```

**Remote HTTP access** (ZCode / any MCP HTTP client):

```json
{
  "mcpServers": {
    "tscircuit": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `TSCIRCUIT_MCP_OUTPUT_DIR` | `./output` | Output directory for SVG/CSV/GLB artifacts |
| `TSCIRCUIT_MCP_REGISTRY_CACHE` | `./registry-cache` | Registry component cache directory |
| `TSCIRCUIT_MCP_OFFLINE` | (unset) | `1` forces offline: no network, local component cache only |
| `TSCIRCUIT_REGISTRY_API_BASE_URL` | `https://registry-api.tscircuit.com` | Component registry API |
| `TSCIRCUIT_CJS_REGISTRY_URL` | `https://cjs.tscircuit.com` | Upstream for component code (CJS bundles); can point to a self-hosted mirror |
| `TSCIRCUIT_MCP_PUBLIC_BASE_URL` | (auto-derived from the Host header) | Prefix for preview URLs returned by tools; set explicitly when a reverse proxy rewrites Host |

## 🔄 Typical Workflow (agent's perspective)

1. Read `tscircuit://docs/api-reference` to learn the syntax
2. `tscircuit_eval` to submit TSX circuit code (errors come back with concrete causes)
3. `tscircuit_check_circuit` to run DRC; fix the code per findings and re-eval
4. `tscircuit_render_pcb_svg` / `tscircuit_render_schematic_svg` — **PNGs are embedded directly in the response, the agent sees the render immediately**, and gets a `http://<host>/view/xxx.svg` interactive preview link to relay to the user
5. `tscircuit_export_gltf` — export the 3D model, returns a `http://<host>/view/xxx.glb` orbit-preview link
6. `tscircuit_export_bom_csv` / `tscircuit_export_pnp_csv` for manufacturing deliverables

## 🐳 Docker Deployment & Artifact Persistence

- All artifacts (PCB/schematic/assembly SVGs, GLB 3D models, BOM/PnP CSVs, CircuitJson) are written to `/data/output`
- Compose mounts it to the host's `./output/` — **artifacts survive container restarts/rebuilds**
- On startup (and for each new MCP session) the artifact index is **rebuilt from that directory** — after a restart, `/files`, `tscircuit://session/artifacts` and preview links keep working
- The container runs as `node` (uid 1000); if the host directory has a different owner, run `chown -R 1000:1000 ./output`

## 💻 Development

```bash
npm run dev              # run src directly with tsx (stdio)
npm run dev -- --http    # HTTP mode
npm run build            # esbuild bundle to dist/ (incl. viewer & model-viewer frontend assets)
npm run typecheck        # tsc --noEmit (third-party packages in node_modules shipping .ts sources produce type noise; src/ should have zero errors)
npm run test             # starts an HTTP server then runs scripts/e2e-http.mjs (20 protocol-level checks)
```

End-to-end test:

```bash
node dist/index.js --http --port 3777 &
node scripts/e2e-http.mjs
```

## 🏗 Architecture

```
src/
├── index.ts              # CLI entry (--http / stdio)
├── server.ts             # McpServer assembly: 18 tools + 4 resources + 2 prompts
├── transports/
│   ├── http.ts           # Express: Streamable HTTP + legacy SSE + /health + viewer
│   └── stdio.ts          # StdioServerTransport
├── tools/                # one module per tool
├── lib/
│   ├── circuit-session.ts  # per-MCP-session circuit state
│   ├── summary.ts          # CircuitJson → LLM-friendly summary
│   ├── output.ts           # artifact writing
│   └── registry-client.ts  # registry-api.tscircuit.com client
└── docs/reference.ts     # built-in tscircuit syntax docs (resource)
```

Underlying dependencies: `@tscircuit/eval` (TSX→CircuitJson), `circuit-to-svg` (schematic/PCB/assembly SVG), `circuit-json-to-gltf` (3D), `circuit-json-to-pnp-csv` / `circuit-json-to-bom-csv` (manufacturing data), `@tscircuit/checks` (DRC), `@tscircuit/footprinter` (footprints), `kicad-to-circuit-json` (KiCad footprint parsing), `@modelcontextprotocol/sdk` (MCP protocol).

## License

MIT
