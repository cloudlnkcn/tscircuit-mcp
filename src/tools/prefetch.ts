import { z } from "zod"
import { searchRegistry } from "../lib/registry-client.js"
import {
  prefetchComponent,
  parseComponentName,
  getCacheStatus,
  startRegistryProxy,
  isOfflineForced,
} from "../lib/registry-proxy.js"
import type { ToolCallback } from "../types.js"

const prefetchInput = {
  components: z
    .array(z.string())
    .optional()
    .describe(
      'Components to cache, each as "owner/name" or "@tsci/owner.name", e.g. ["rushabhcodes/ESP32-E-Reader"]. Their @tsci dependencies are fetched recursively.',
    ),
  query: z
    .string()
    .optional()
    .describe("Search the registry and cache the top results instead of listing components explicitly."),
  limit: z.number().int().min(1).max(50).optional().default(5).describe("Max results when using query (default 5)."),
}

export const prefetchComponents: ToolCallback<typeof prefetchInput> = {
  name: "tscircuit_prefetch_components",
  title: "Prefetch registry components for offline use",
  description:
    "Download tscircuit registry components (compiled bundles + their @tsci dependencies, recursively) " +
    "into the local registry cache so they keep working with no network. Give explicit component names " +
    "and/or a search query. Run this while online; afterwards tscircuit_eval resolves these imports offline.",
  inputSchema: prefetchInput,
  annotations: { readOnlyHint: false, openWorldHint: true },

  async execute({ components, query, limit }, _session) {
    if (isOfflineForced()) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Server is in offline mode (TSCIRCUIT_MCP_OFFLINE=1) — prefetching requires network access.",
          },
        ],
        isError: true,
      }
    }
    // Make sure the proxy (and cache dirs) exist
    await startRegistryProxy()

    const targets: string[] = []

    if (query) {
      const found = await searchRegistry(query, limit ?? 5)
      for (const s of found) targets.push(s.name)
      if (found.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No registry results for "${query}".` }],
        }
      }
    }
    for (const c of components ?? []) targets.push(c)

    if (targets.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Provide `components` (list of owner/name) or `query` (search term).",
          },
        ],
        isError: true,
      }
    }

    const results: string[] = []
    for (const t of targets) {
      const parsed = parseComponentName(t)
      if (!parsed) {
        results.push(`- SKIP (unparsable name): ${t}`)
        continue
      }
      const r = await prefetchComponent(parsed.owner, parsed.name)
      const label = `@tsci/${parsed.owner}.${parsed.name}`
      if (r.status === "error") {
        results.push(`- ERROR ${label}: ${r.error}`)
      } else if (r.status === "already-cached") {
        results.push(`- ALREADY CACHED ${label}`)
      } else {
        results.push(`- CACHED ${label} (${(r.bytes ?? 0).toLocaleString()} bytes, deps: ${r.dependencies?.length ?? 0})`)
      }
    }

    const status = getCacheStatus()
    return {
      content: [
        {
          type: "text" as const,
          text:
            `# Registry cache updated\n\n${results.join("\n")}\n\n` +
            `Cache now holds ${status.component_count} component(s), ${status.asset_count} asset(s), ` +
            `${(status.total_bytes / 1024).toFixed(1)} KB total at ${status.cache_dir}.\n` +
            `These components will now evaluate correctly with no network access.`,
        },
      ],
    }
  },
}

export const registryCacheStatus: ToolCallback<Record<string, never>> = {
  name: "tscircuit_registry_cache_status",
  title: "Show local registry cache status",
  description:
    "List the components (and assets) cached in the local registry cache for offline use, with sizes " +
    "and cache location. Also reports whether the server is forced into offline mode.",
  inputSchema: {},
  annotations: { readOnlyHint: true },

  async execute() {
    const s = getCacheStatus()
    const lines = [
      `# Registry cache`,
      `- Location: ${s.cache_dir}`,
      `- Offline mode forced: ${s.offline_mode ? "yes (TSCIRCUIT_MCP_OFFLINE=1)" : "no (online with automatic offline fallback)"}`,
      `- Cached components: ${s.component_count}`,
      `- Cached 3D/static assets: ${s.asset_count}`,
      `- Total size: ${(s.total_bytes / 1024).toFixed(1)} KB`,
      "",
      ...(s.components.length
        ? ["## Cached components", ...s.components.map((c) => `- @tsci/${c.name.replace("/", ".")} (${c.bytes.toLocaleString()} bytes)`)]
        : ["(cache is empty — run tscircuit_prefetch_components while online)"]),
    ]
    return { content: [{ type: "text" as const, text: lines.join("\n") }] }
  },
}
