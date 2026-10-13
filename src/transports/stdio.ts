import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createMcpServer } from "../server.js"

/** Run the MCP server over stdio (for local clients like Claude Desktop). */
export async function startStdioServer(): Promise<void> {
  const server = createMcpServer("stdio")
  await server.connect(new StdioServerTransport())
  console.error("tscircuit-mcp running on stdio")
}
