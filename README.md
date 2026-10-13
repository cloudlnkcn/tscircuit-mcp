# tscircuit-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org/)
[![Protocol](https://img.shields.io/badge/protocol-MCP-7c3aed.svg)](https://modelcontextprotocol.io/)

基于 [tscircuit](https://github.com/tscircuit/tscircuit) 的**全功能 MCP (Model Context Protocol) Server**，让 AI 助手（Claude、Cursor、ZCode 等）能够直接编写、评估、检查、预览和导出 PCB 电路——从一行自然语言描述到可制造的交付物（BOM / 坐标文件 / 3D 模型），全程在一个会话内完成。

仓库地址：https://github.com/cloudlnkcn/tscircuit-mcp

支持 **Streamable HTTP**（远程/容器部署）、**传统 HTTP+SSE**（旧客户端兼容）和 **stdio**（本地客户端）三种传输方式。

## ✨ 特性总览

| | 特性 | 说明 |
|---|---|---|
| 🔧 | **18 个工具 / 4 资源 / 2 Prompts** | 覆盖评估、DRC、渲染、3D 导出、制造交付、注册表检索、封装生成的完整链路 |
| 🖥 | **交互式 PCB 查看器** | 内置 [tscircuit/pcb-viewer](https://github.com/tscircuit/pcb-viewer)，浏览器中缩放/平移/悬停检查，而非静态截图 |
| 🖼 | **内嵌 PNG 渲染** | 所有渲染工具在 MCP 响应中直接返回 PNG，agent 无需二次请求即可"看到"结果 |
| 📐 | **自动布局与布线** | 坐标属性全部可选，引擎按连通性自动完成元件布局、PCB 走线和原理图排布 |
| 📴 | **离线可用** | 注册表组件本地缓存代理，联网预热后断网照常评估，适配隔离环境 |
| 💬 | **会话式工作流** | 评估产生的电路保存在会话中，渲染/导出/检查链式调用无需重复传代码 |
| 🐳 | **Docker 一键部署** | 镜像内置完整 tscircuit 工具链与 `tsci` CLI，产物 volume 持久化，重启不丢 |
| 🔍 | **实测验证的元素清单** | 95 个合法 JSX 元素逐一对着评估器验证，避免 agent 使用静默无效元素 |

## 🛠 工具（18 个）

### 核心评估与检查

| 工具 | 说明 |
|---|---|
| `tscircuit_eval` | 评估 tscircuit TSX 电路代码 → CircuitJson 摘要 + 编译/运行时错误。支持多文件 `files` 映射与注册表自动导入（`@tsci/...`） |
| `tscircuit_check_circuit` | DRC 设计规则检查：布局、走线、间距、庭院重叠、引脚规范、原理图检查、未连接端口等 |

### 渲染与交互预览

| 工具 | 说明 |
|---|---|
| `tscircuit_render_schematic_svg` | 渲染原理图 SVG |
| `tscircuit_render_pcb_svg` | 渲染 PCB 布局 SVG（支持暗色模式） |
| `tscircuit_render_assembly_svg` | 渲染 3D 风格装配图 SVG |
| `tscircuit_preview_kicad_footprint` | KiCad 封装（`.kicad_mod` s-expression）→ CircuitJson + 交互式查看器 URL（等价于 [tscircuit/kicad-viewer](https://github.com/tscircuit/kicad-viewer) 的 MCP 化） |

### 3D 与制造交付

| 工具 | 说明 |
|---|---|
| `tscircuit_export_gltf` | 导出 3D 板卡模型（GLB/glTF，含元件 3D 模型），返回 `<model-viewer>` 轨道预览链接 |
| `tscircuit_export_bom_csv` | 导出物料清单（BOM CSV：位号、描述、厂商料号） |
| `tscircuit_export_pnp_csv` | 导出贴片机坐标（Pick & Place CSV：位号、坐标、旋转、层） |

### 会话与数据

| 工具 | 说明 |
|---|---|
| `tscircuit_get_circuit_json` | 获取会话电路的 CircuitJson（可按元素类型过滤、存盘） |

### 注册表与离线缓存

| 工具 | 说明 |
|---|---|
| `tscircuit_search_components` | 搜索 tscircuit 公共组件注册表（tscircuit.com） |
| `tscircuit_get_component` | 获取注册表组件源码与 TypeScript 类型定义 |
| `tscircuit_prefetch_components` | **预热注册表组件到本地缓存**（递归拉取 `@tsci/*` 依赖与 3D 资产），支持关键词批量，断网可用 |
| `tscircuit_registry_cache_status` | 查看本地组件缓存（条目/大小/位置/离线模式状态） |

### 元素与文档

| 工具 | 说明 |
|---|---|
| `tscircuit_list_elements` | **全量合法元素清单**（95 个，逐一对着评估器实测验证，非类型推断） |
| `tscircuit_get_element_docs` | 查询元素 props 文档（来自 @tscircuit/props 类型定义 + 高频元件手写文档） |

### 脚手架与封装

| 工具 | 说明 |
|---|---|
| `tscircuit_generate_footprint` | footprinter DSL 生成封装（`soic8`、`qfp48`、`pinrow4_p2.54mm`…），输出 CircuitJson 或 SVG |
| `tscircuit_create_project` | 脚手架创建 tscircuit 项目（package.json + tsconfig + gitignore + 示例电路） |

评估产生的电路保存在**会话**中，后续渲染/导出/检查工具无需重复传代码，支持链式迭代工作流。

## 🖥 交互式预览（真实查看器，而非静态图片）

内置 [tscircuit/pcb-viewer](https://github.com/tscircuit/pcb-viewer)（React + canvas/WebGPU 交互式渲染器）：

- **`GET /viewer?file=<circuit.json>`** — 全屏交互式 PCB 查看器：缩放、平移、悬停检查焊盘/走线/位号。自动探测 WebGPU，不可用时回退 canvas2d（无头浏览器/Firefox/Safari 也可用）
- **`GET /view/<x>.circuit.json`** — CircuitJson 产物自动跳转到交互查看器
- 所有渲染工具除返回内嵌 PNG 外，同时持久化 `<name>.circuit.json` 并附带 **Interactive PCB viewer** 链接，agent 可直接把交互预览 URL 转述给用户
- 3D 模型：`tscircuit_export_gltf` 的 `/view/<x>.glb` 提供 `<model-viewer>` 轨道预览

## 📐 布局自动化（无需手写坐标）

tscircuit 引擎内置自动布局与自动布线：**`pcbX`/`pcbY`/`schX`/`schY` 全部是可选属性**。省略坐标时引擎自动完成元件布局（按连通性摆放、不重叠）、PCB 走线布线和原理图符号排布。手写坐标只在有明确布局意图时才需要（如去耦电容贴近 MCU）。

为让 agent 直接遵循此规范，MCP 提供三层保障：

1. `tscircuit://docs/api-reference` 资源与 `create-circuit` prompt 都以"自动布局优先"为第一原则
2. `tscircuit_list_elements` 让 agent 在写代码前确认合法元素名（避免 `<ground>` 这类静默无效元素——文档中明确警告）
3. `tscircuit_get_element_docs` 提供每个元素的 props 签名，不再需要翻在线文档

## 📴 离线可用（注册表组件本地化）

`@tsci/owner.name` 组件通过**内置注册表缓存代理**实现断网可用：

- 评估时所有 registry 请求都经过本地代理（`127.0.0.1` 内部端口）
- **在线**：请求穿透上游并写入磁盘缓存（`TSCIRCUIT_MCP_REGISTRY_CACHE`，默认 `./registry-cache`）
- **离线**（自动回退，或 `TSCIRCUIT_MCP_OFFLINE=1` 强制）：直接读缓存；未缓存的组件返回明确的"未缓存"错误
- bundle 依赖的裸包（`react`、`react/jsx-runtime`）从本地 node_modules 注入评估器（避免 CDN 双 React 实例导致的静默渲染失败）；`tscircuit` 包通过 globalThis 桥接注入

断网工作流：

```bash
# 1. 联网时预热（支持搜索批量：{"query": "esp32", "limit": 10}）
#    agent 调用: tscircuit_prefetch_components {"components": ["rushabhcodes/ESP32-E-Reader"]}

# 2. 断网后照常使用
#    agent 调用: tscircuit_eval {"code": "import { EReaderBoard } from \"@tsci/rushabhcodes.ESP32-E-Reader\"\nexport default () => <EReaderBoard name=\"X\" />"}
```

缓存随 Docker volume `./registry-cache:/data/registry-cache` 持久化，容器重启/重建不丢。

## 📦 资源（4 个）

- `tscircuit://docs/api-reference` — tscircuit TSX 语法速查（LLM 写代码必备）
- `tscircuit://docs/examples` — 可直接评估的示例电路
- `tscircuit://session/summary` — 当前会话电路摘要
- `tscircuit://session/artifacts` — 本次会话产物索引

## 📝 Prompts（2 个）

- `create-circuit` — 从自然语言描述到可用电路的引导工作流
- `review-circuit` — 会话电路的审查与修复流程

## 🚀 快速开始

```bash
git clone https://github.com/cloudlnkcn/tscircuit-mcp.git
cd tscircuit-mcp
npm install
npm run build
```

### Docker Compose（推荐，镜像内置完整工具链）

镜像在 `node:22-bookworm-slim` 上构建，除 MCP Server 外还预装了**完整 tscircuit 工具链**：

- `tscircuit` 聚合包（全局，含 `tsci` CLI、core、eval、runframe、footprinter、checks 等全部官方子包）
- 元器件库：`@tscircuit/footprinter`（封装库）、`schematic-symbols`（原理图符号库）、`@tscircuit/parts-engine`（JLCPCB/EasyEDA 零件引擎）

```bash
docker compose up -d --build          # 构建并启动，监听 3000 端口
curl http://127.0.0.1:3000/health     # {"ok":true,...}

# 客户端接入
#   Streamable HTTP:  http://127.0.0.1:3000/mcp
#   Legacy SSE:       http://127.0.0.1:3000/sse

# 渲染/导出的产物（SVG/CSV/GLB/JSON）持久化在宿主机 ./output/
docker compose exec tscircuit-mcp tsci --version   # 容器内可用 tsci CLI

# stdio 模式（本地客户端通过 docker run -i 使用）
docker compose --profile stdio run --rm tscircuit-mcp-stdio
# 或等价地（必须显式覆盖 command，否则默认启动 HTTP）：
docker run -i --rm tscircuit-mcp:latest node dist/index.js
# Claude Desktop 配置示例：
#   "command": "docker", "args": ["run","-i","--rm","tscircuit-mcp:latest","node","dist/index.js"]
```

### 启动 HTTP 服务器（本机运行）

```bash
# Streamable HTTP，默认 0.0.0.0:3000
node dist/index.js --http

# 自定义端口/主机
node dist/index.js --http --port 8080 --host 127.0.0.1
```

端点：

- `POST /mcp` — Streamable HTTP（MCP 当前规范），会话通过 `mcp-session-id` 头维持
- `GET /mcp` / `DELETE /mcp` — 会话 SSE 流 / 终止会话
- `GET /sse` + `POST /messages` — 传统 HTTP+SSE 传输（兼容旧客户端）
- `GET /health` — 健康检查

### stdio 模式（Claude Desktop 等本地客户端）

```bash
node dist/index.js            # 默认 stdio
```

### 客户端配置

**Claude Desktop / Cursor（stdio）** `claude_desktop_config.json`：

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

**HTTP 远程接入**（ZCode / 任意 MCP HTTP 客户端）：

```json
{
  "mcpServers": {
    "tscircuit": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TSCIRCUIT_MCP_OUTPUT_DIR` | `./output` | SVG/CSV/GLB 产物输出目录 |
| `TSCIRCUIT_MCP_REGISTRY_CACHE` | `./registry-cache` | 注册表组件缓存目录 |
| `TSCIRCUIT_MCP_OFFLINE` | （未设置） | `1` 强制离线：禁网、只用本地组件缓存 |
| `TSCIRCUIT_REGISTRY_API_BASE_URL` | `https://registry-api.tscircuit.com` | 组件注册表 API |
| `TSCIRCUIT_CJS_REGISTRY_URL` | `https://cjs.tscircuit.com` | 组件代码（CJS bundle）上游，可指向自建镜像 |
| `TSCIRCUIT_MCP_PUBLIC_BASE_URL` | （自动从 Host 头推导） | 工具返回的预览 URL 前缀；反向代理改写 Host 时需显式设置 |

## 🔄 典型工作流（agent 视角）

1. 读取 `tscircuit://docs/api-reference` 了解语法
2. `tscircuit_eval` 提交 TSX 电路代码（错误会带回具体原因）
3. `tscircuit_check_circuit` 跑 DRC，按提示修代码再 eval
4. `tscircuit_render_pcb_svg` / `tscircuit_render_schematic_svg` —— **响应中直接内嵌 PNG，agent 立即看到渲染结果**，并拿到 `http://<host>/view/xxx.svg` 交互预览链接转述给用户
5. `tscircuit_export_gltf` —— 导出 3D 模型，返回 `http://<host>/view/xxx.glb` 轨道预览链接
6. `tscircuit_export_bom_csv` / `tscircuit_export_pnp_csv` 出制造交付物

## 🐳 Docker 部署与资产持久化

- 所有产物（PCB/原理图/装配 SVG、GLB 3D 模型、BOM/PnP CSV、CircuitJson）都写入 `/data/output`
- Compose 将其挂载到宿主机 `./output/`，**容器重启/重建后资产不丢**
- 服务启动（及每个新 MCP 会话创建）时自动从该目录**重建产物索引**——重启后 `/files`、`tscircuit://session/artifacts` 与预览链接照常可用
- 容器以 `node`(uid 1000) 运行；若宿主机目录属主不同，执行 `chown -R 1000:1000 ./output`

## 💻 开发

```bash
npm run dev              # tsx 直接运行 src（stdio）
npm run dev -- --http    # HTTP 模式
npm run build            # esbuild 打包到 dist/（含 viewer 与 model-viewer 前端资源）
npm run typecheck        # tsc --noEmit（node_modules 中第三方包发布的 .ts 源码有类型噪音，src/ 应为零错误）
npm run test             # 启动 HTTP server 后跑 scripts/e2e-http.mjs（20 项协议级检查）
```

端到端测试：

```bash
node dist/index.js --http --port 3777 &
node scripts/e2e-http.mjs
```

## 🏗 架构

```
src/
├── index.ts              # CLI 入口（--http / stdio）
├── server.ts             # McpServer 组装：18 工具 + 4 资源 + 2 prompts
├── transports/
│   ├── http.ts           # Express：Streamable HTTP + legacy SSE + /health + viewer
│   └── stdio.ts          # StdioServerTransport
├── tools/                # 每个工具一个模块
├── lib/
│   ├── circuit-session.ts  # 每 MCP 会话的电路状态
│   ├── summary.ts          # CircuitJson → LLM 友好摘要
│   ├── output.ts           # 产物写入
│   └── registry-client.ts  # registry-api.tscircuit.com 客户端
└── docs/reference.ts     # 内置 tscircuit 语法文档（资源）
```

底层依赖：`@tscircuit/eval`（TSX→CircuitJson）、`circuit-to-svg`（原理图/PCB/装配 SVG）、`circuit-json-to-gltf`（3D）、`circuit-json-to-pnp-csv` / `circuit-json-to-bom-csv`（制造数据）、`@tscircuit/checks`（DRC）、`@tscircuit/footprinter`（封装）、`kicad-to-circuit-json`（KiCad 封装解析）、`@modelcontextprotocol/sdk`（MCP 协议）。

## License

MIT
