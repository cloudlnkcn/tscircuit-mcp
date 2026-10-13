import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { allTools } from "./tools/index.js"
import { getSession } from "./lib/circuit-session.js"
import { summarizeCircuitJson } from "./lib/summary.js"
import { API_REFERENCE, EXAMPLES } from "./docs/reference.js"
import { getOutputDir } from "./lib/output.js"
import type { ToolCallback } from "./types.js"

/**
 * Build a fully-configured McpServer instance bound to a session id.
 * Each transport (stdio / each HTTP session) gets its own instance;
 * tool implementations share state through the CircuitSession store.
 */
export function createMcpServer(
  sessionId: string,
  opts: { baseUrl?: string | null } = {},
): McpServer {
  const server = new McpServer(
    { name: "tscircuit-mcp", version: "0.1.0", title: "tscircuit MCP Server" },
    {
      instructions:
        "Tools for building, checking and exporting electronics circuits with tscircuit " +
        "(React-style TSX for PCBs). Typical flow: read `tscircuit://docs/api-reference`, write TSX " +
        "circuit code, call `tscircuit_eval`, then iterate with `tscircuit_check_circuit`, " +
        "render/export tools. Read `tscircuit://docs/examples` for templates.",
    },
  )

  const session = getSession(sessionId)

  // ----------------------------------------------------------------
  // Tools
  // ----------------------------------------------------------------
  for (const tool of allTools as ToolCallback<any>[]) {
    server.registerTool(
      tool.name,
      {
        title: tool.title ?? tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations as never,
      },
      async (args: any) => {
        try {
          return await tool.execute(args, session, {
            sessionId,
            baseUrl: opts.baseUrl ?? null,
          })
        } catch (err: any) {
          const message = String(err?.message ?? err)
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Tool ${tool.name} failed: ${message.slice(0, 2000)}\n\n` +
                  "If the circuit is missing, call `tscircuit_eval` first. " +
                  "See the `tscircuit://docs/api-reference` resource for syntax help.",
              },
            ],
            isError: true,
          }
        }
      },
    )
  }

  // ----------------------------------------------------------------
  // Resources
  // ----------------------------------------------------------------
  server.registerResource(
    "tscircuit-api-reference",
    "tscircuit://docs/api-reference",
    {
      title: "tscircuit TSX API reference",
      description:
        "Concise tscircuit language reference: board, components, traces, footprints, layout, simulation.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: API_REFERENCE }],
    }),
  )

  server.registerResource(
    "tscircuit-examples",
    "tscircuit://docs/examples",
    {
      title: "tscircuit example circuits",
      description: "Ready-to-eval example TSX circuit templates.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: EXAMPLES }],
    }),
  )

  server.registerResource(
    "session-circuit-summary",
    "tscircuit://session/summary",
    {
      title: "Current session circuit summary",
      description:
        "Summary of the circuit from the most recent tscircuit_eval in this session: components, nets, errors.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      if (!session.circuitJson) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: "No circuit evaluated in this session yet. Call `tscircuit_eval` first.",
            },
          ],
        }
      }
      const summary = summarizeCircuitJson(session.circuitJson)
      const text = [
        `# Session circuit summary`,
        session.sourceCode ? "\nLast source code:\n\n```tsx\n" + session.sourceCode + "\n```" : "",
        "\n## Summary\n",
        `- Elements: ${summary.element_count}`,
        `- Board: ${summary.board ? `${summary.board.width}x${summary.board.height}mm` : "(none)"}`,
        `- Nets: ${summary.nets.join(", ") || "(none)"}`,
        `- Errors: ${summary.errors.length}, Warnings: ${summary.warnings.length}`,
        "",
        ...summary.components.map(
          (c) => `- ${c.name} (${c.type})${c.footprint ? ` [${c.footprint}]` : ""}`,
        ),
      ].join("\n")
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] }
    },
  )

  server.registerResource(
    "session-artifacts",
    "tscircuit://session/artifacts",
    {
      title: "Session artifacts index",
      description: "All files (SVGs, exports) written during this session, with absolute paths.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text:
            `# Artifacts (output dir: ${getOutputDir()})\n\n` +
            (session.artifacts.length === 0
              ? "No artifacts yet."
              : session.artifacts
                  .slice()
                  .reverse()
                  .map((a) => `- [${a.kind}] ${a.path} (${a.created_at})`)
                  .join("\n")),
        },
      ],
    }),
  )

  // ----------------------------------------------------------------
  // Prompts
  // ----------------------------------------------------------------
  server.registerPrompt(
    "create-circuit",
    {
      title: "Create a circuit from a description",
      description: "Guided workflow: turn a plain-language circuit description into working tscircuit code.",
      argsSchema: {
        description: z.string().describe("What the circuit should do, e.g. 'USB-powered LED blinker'"),
      },
    },
    ({ description }: { description: string }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Create a tscircuit circuit: ${description}\n\n` +
              "Steps:\n" +
              "1. Read the resource `tscircuit://docs/api-reference` for syntax.\n" +
              "2. Call `tscircuit_list_elements` to confirm valid element names; use `tscircuit_get_element_docs` for props.\n" +
              "3. Write the TSX code — do NOT hand-write pcbX/pcbY/schX/schY coordinates; omit them and " +
              "the engine auto-places components and auto-routes traces.\n" +
              "4. Evaluate with `tscircuit_eval`; fix errors until it passes. Ground with to=\"net.GND\" (never <ground/>).\n" +
              "5. Run `tscircuit_check_circuit` and resolve DRC errors/warnings.\n" +
              "6. Render schematic + PCB (returns inline images and interactive viewer URLs) and report the links.",
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    "review-circuit",
    {
      title: "Review a circuit design",
      description: "Review the current session circuit for errors, missing connections and best practices.",
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              "Review the current session circuit:\n" +
              "1. Read `tscircuit://session/summary`.\n" +
              "2. Run `tscircuit_check_circuit` for DRC findings.\n" +
              "3. Report each issue with the component/net involved and a concrete code fix, " +
              "then apply fixes via `tscircuit_eval` and re-check.",
          },
        },
      ],
    }),
  )

  return server
}
