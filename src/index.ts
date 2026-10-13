#!/usr/bin/env node

/**
 * tscircuit-mcp — full-featured MCP server for tscircuit.
 *
 * Usage:
 *   tscircuit-mcp                    # stdio transport (default)
 *   tscircuit-mcp --http             # Streamable HTTP on 0.0.0.0:3000
 *   tscircuit-mcp --http --port 8080 --host 127.0.0.1
 *
 * Environment:
 *   TSCIRCUIT_MCP_OUTPUT_DIR   output directory for SVG/CSV/GLB artifacts
 *                              (default: ./output under the process cwd)
 *   TSCIRCUIT_REGISTRY_API_BASE_URL  registry API base (default: https://registry-api.tscircuit.com)
 */

import { startStdioServer } from "./transports/stdio.js"
import { startHttpServer } from "./transports/http.js"
import { startRegistryProxy, getCacheStatus, isOfflineForced } from "./lib/registry-proxy.js"

function parseArgs(argv: string[]) {
  const opts = {
    http: false,
    port: 3000,
    host: "0.0.0.0",
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case "--http":
      case "http":
        opts.http = true
        break
      case "--stdio":
        opts.http = false
        break
      case "--port":
        opts.port = Number(argv[++i])
        break
      case "--host":
        opts.host = argv[++i]
        break
      case "--help":
      case "-h":
        opts.help = true
        break
    }
  }
  return opts
}

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(`tscircuit-mcp — MCP server for tscircuit electronics design

Usage:
  tscircuit-mcp [--http] [--port N] [--host H] [--stdio]

Transports:
  stdio (default)          JSON-RPC over stdin/stdout
  --http                   Streamable HTTP at POST /mcp (+ legacy /sse)

Environment:
  TSCIRCUIT_MCP_OUTPUT_DIR           artifact output directory
  TSCIRCUIT_REGISTRY_API_BASE_URL    tscircuit registry API base
`)
  process.exit(0)
}

;(async () => {
  // Local registry cache-proxy: lets @tsci/* imports resolve from disk offline.
  const proxy = await startRegistryProxy()
  const cache = getCacheStatus()
  console.error(
    `registry cache: ${cache.component_count} component(s) at ${cache.cache_dir}` +
      (isOfflineForced() ? " [OFFLINE MODE]" : " [online, offline fallback enabled]"),
  )
  if (args.http) {
    await startHttpServer({ host: args.host, port: args.port })
  } else {
    await startStdioServer()
  }
  void proxy
})().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
