import type { z } from "zod"
import type { CircuitSession } from "./lib/circuit-session.js"
import type { AnyCircuitElement } from "circuit-json"

/** Per-call context handed to every tool execution. */
export interface ToolExtra {
  sessionId: string
  /**
   * Public base URL of the HTTP server (e.g. "http://127.0.0.1:3000"),
   * used to build preview links for artifacts. Null in stdio mode.
   */
  baseUrl: string | null
}

/**
 * The shape every tool callback implements. `S` is the zod raw shape
 * (a plain object of zod validators, not a z.object).
 */
export interface ToolCallback<S extends Record<string, z.ZodTypeAny> = Record<string, z.ZodTypeAny>> {
  name: string
  title?: string
  description: string
  inputSchema: S
  annotations?: Record<string, unknown>
  execute(
    args: { [K in keyof S]: z.infer<S[K]> },
    session: CircuitSession,
    extra: ToolExtra,
  ): Promise<ToolResult> | ToolResult
}

export type ToolContentItem =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/png" }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string }

export interface ToolResult {
  [key: string]: unknown
  content: ToolContentItem[]
  isError?: boolean
  structuredContent?: Record<string, unknown>
}

/** Shared helper: resolve the circuit JSON to operate on. */
export function resolveCircuitJson(
  session: CircuitSession,
  explicit?: AnyCircuitElement[] | Record<string, unknown>,
): AnyCircuitElement[] {
  if (explicit !== undefined && explicit !== null) {
    // An explicit argument — whatever it is — must be a usable circuit array;
    // silently falling back to the session circuit would mask bad calls.
    if (!Array.isArray(explicit) || explicit.length === 0) {
      throw new Error("`circuit_json` must be a non-empty array of circuit elements.")
    }
    return explicit as AnyCircuitElement[]
  }
  return session.requireCircuit()
}
