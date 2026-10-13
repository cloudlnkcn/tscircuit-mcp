/**
 * Minimal HTTP client for the public tscircuit component registry
 * (registry-api.tscircuit.com).
 *
 * Endpoints used:
 *   GET /snippets/search?q=...            -> { snippets: [...] }
 *   GET /snippets/get?owner_name=..&unscoped_name=.. -> { snippet: {...} }
 */

export interface RegistrySnippet {
  name: string // "owner/unscoped_name"
  unscoped_name: string
  owner_name: string
  snippet_type: string
  description?: string
  ai_description?: string
  star_count?: number
  code?: string
  dts?: string
  updated_at?: string
}

const DEFAULT_BASE =
  process.env.TSCIRCUIT_REGISTRY_API_BASE_URL ?? "https://registry-api.tscircuit.com"

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Registry request failed (${res.status}): ${body.slice(0, 300)}`)
  }
  return res.json()
}

export async function searchRegistry(
  query: string,
  limit = 10,
): Promise<RegistrySnippet[]> {
  const url = `${DEFAULT_BASE}/snippets/search?q=${encodeURIComponent(query)}`
  const data = await fetchJson(url)
  return (data.snippets ?? []).slice(0, limit) as RegistrySnippet[]
}

export async function getRegistrySnippet(
  ownerName: string,
  unscopedName: string,
): Promise<RegistrySnippet> {
  const url =
    `${DEFAULT_BASE}/snippets/get?owner_name=${encodeURIComponent(ownerName)}` +
    `&unscoped_name=${encodeURIComponent(unscopedName)}`
  const data = await fetchJson(url)
  if (!data.ok) {
    throw new Error(`Component not found: ${ownerName}/${unscopedName}`)
  }
  return data.snippet as RegistrySnippet
}
