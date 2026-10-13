import type { AnyCircuitElement } from "circuit-json"
import { hydrateArtifactsFromDisk } from "./output.js"

/**
 * Per-client state that survives across tool calls.
 * In HTTP mode each MCP session id gets its own CircuitSession;
 * in stdio mode there is a single "default" session.
 */
export class CircuitSession {
  /** Latest successfully evaluated circuit */
  circuitJson: AnyCircuitElement[] | null = null
  /** The code that produced `circuitJson` */
  sourceCode: string | null = null
  /** History of (name, timestamp) pairs of artifacts written this session */
  artifacts: { path: string; kind: string; created_at: string }[] = []
  /** Last eval diagnostics (errors / warnings), even on failure */
  lastDiagnostics: {
    ok: boolean
    errors: string[]
    warnings: string[]
    element_count: number | null
  } | null = null

  setCircuit(circuitJson: AnyCircuitElement[], code: string) {
    this.circuitJson = circuitJson
    this.sourceCode = code
  }

  addArtifact(path: string, kind: string) {
    this.artifacts.push({
      path,
      kind,
      created_at: new Date().toISOString(),
    })
  }

  /** Get the active circuit or throw a helpful error. */
  requireCircuit(): AnyCircuitElement[] {
    if (!this.circuitJson || this.circuitJson.length === 0) {
      throw new Error(
        "No circuit in this session yet. Call `tscircuit_eval` with your TSX circuit code first, " +
          "or pass `circuit_json` explicitly to this tool.",
      )
    }
    return this.circuitJson
  }
}

const globalSessions = new Map<string, CircuitSession>()

export function getSession(sessionId: string = "default"): CircuitSession {
  let s = globalSessions.get(sessionId)
  if (!s) {
    s = new CircuitSession()
    // Make artifacts that already exist on disk (from previous runs, other
    // sessions, or the tsci CLI) visible to this session.
    try {
      hydrateArtifactsFromDisk(s)
    } catch {
      // output dir unavailable — session starts empty
    }
    globalSessions.set(sessionId, s)
  }
  return s
}

export function deleteSession(sessionId: string) {
  globalSessions.delete(sessionId)
}
