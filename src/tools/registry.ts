import { z } from "zod"
import { searchRegistry, getRegistrySnippet } from "../lib/registry-client.js"
import type { ToolCallback } from "../types.js"

const searchInput = {
  query: z.string().min(1).describe("Search keywords, e.g. 'esp32', 'rp2040', 'usb-c'."),
  limit: z.number().int().min(1).max(50).optional().default(10).describe("Max results (default 10)."),
}

export const searchComponents: ToolCallback<typeof searchInput> = {
  name: "tscircuit_search_components",
  title: "Search tscircuit registry",
  description:
    "Search the public tscircuit component registry (tscircuit.com) for reusable circuit modules, " +
    "chips and footprints. Returns name, description, stars and import name for each result.",
  inputSchema: searchInput,
  annotations: { readOnlyHint: true, openWorldHint: true },

  async execute({ query, limit }) {
    const snippets = await searchRegistry(query, limit ?? 10)
    if (snippets.length === 0) {
      return {
        content: [{ type: "text" as const, text: `No components found for "${query}".` }],
      }
    }
    const lines = [`# Registry results for "${query}" (${snippets.length})\n`]
    for (const s of snippets) {
      const importName = `@tsci/${s.name.replace("/", ".")}`
      lines.push(
        [
          `## ${s.name}`,
          s.ai_description || s.description || "(no description)",
          `- Import: \`import ... from "${importName}"\``,
          `- Type: ${s.snippet_type}${s.star_count != null ? ` | ★ ${s.star_count}` : ""}`,
          s.updated_at ? `- Updated: ${s.updated_at}` : "",
          "",
        ]
          .filter(Boolean)
          .join("\n"),
      )
    }
    lines.push(
      "Use `tscircuit_get_component` with owner_name/unscoped_name to fetch source code, " +
        "or import the package directly in tscircuit_eval code.",
    )
    return { content: [{ type: "text" as const, text: lines.join("\n") }] }
  },
}

const getComponentInput = {
  owner_name: z.string().describe("Registry owner/username, e.g. 'seveibar'."),
  unscoped_name: z.string().describe("Component name without owner, e.g. 'ESP32_simple'."),
}

export const getComponent: ToolCallback<typeof getComponentInput> = {
  name: "tscircuit_get_component",
  title: "Fetch registry component source",
  description:
    "Fetch the source code of a component from the tscircuit registry by owner_name and unscoped_name " +
    "(e.g. 'seveibar' + 'ESP32_simple'). Also returns its TypeScript definitions when available.",
  inputSchema: getComponentInput,
  annotations: { readOnlyHint: true, openWorldHint: true },

  async execute({ owner_name, unscoped_name }) {
    const snippet = await getRegistrySnippet(owner_name, unscoped_name)
    const parts = [`# ${snippet.name}\n`]
    if (snippet.ai_description || snippet.description) {
      parts.push(snippet.ai_description ?? snippet.description ?? "(no description)", "")
    }
    if (snippet.code) {
      parts.push("## Source\n\n```tsx\n" + snippet.code + "\n```")
    } else {
      parts.push(
        "## Source\n\n(no inline source for packages — import it in tscircuit_eval instead: " +
          `\`import X from "@tsci/${owner_name}.${unscoped_name}"\`)`,
      )
    }
    if (snippet.dts) {
      parts.push("\n## Type definitions\n\n```ts\n" + snippet.dts.slice(0, 8000) + "\n```")
    }
    return { content: [{ type: "text" as const, text: parts.join("\n") }] }
  },
}
