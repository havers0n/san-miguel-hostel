// Iter 15: Cloud Run proxy executor (DecisionRequest -> HTTP POST /decide).
// Important:
// - No WorldState access here (transport only).
// - No retries here: engine already provides TTL + dedup; proxy provides requestId idempotency.

import type { DecisionRequest, DecisionResult } from "./types";

export type ExecuteDecision = (req: DecisionRequest) => Promise<DecisionResult>;

export function makeProxyExecutor(opts: {
  baseUrl: string; // e.g. https://gemini-proxy-...a.run.app
  timeoutMs?: number; // <= req.ttlMs ideally
  fetchImpl?: typeof fetch; // injection for tests
}): ExecuteDecision {
  const fetchFn = opts.fetchImpl ?? fetch;
  const defaultTimeoutMs = opts.timeoutMs ?? 10_000;
  const MAX_TIMEOUT_MS = 10_000;

  const base = opts.baseUrl.replace(/\/+$/, "");
  const url = `${base}/decide`;

  return async (req) => {
    const controller = new AbortController();
    const timeoutMs = Math.min(MAX_TIMEOUT_MS, defaultTimeoutMs, req.ttlMs ?? defaultTimeoutMs);
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body = {
        request: {
          requestId: req.requestId,
          agentId: req.agentId,
          intentId: req.intentId,
          contextHash: req.contextHash,
          createdAtMs: req.createdAtMs,
          promptVersion: req.promptVersion,
          ttlMs: req.ttlMs,
        },
        context: req.context,
      };

      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`proxy ${res.status}: ${text.slice(0, 200)}`);
      }

      return (await res.json()) as DecisionResult;
    } catch (err) {
      // Normalize AbortError for easier debugging/metrics (no retries at this layer).
      if (err && typeof err === "object" && (err as any).name === "AbortError") {
        throw new Error(`proxy_timeout after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(t);
    }
  };
}


