// Iter 10B: async decision worker transport (без сети/прокси; только runtime queue -> decisionBuffer).
// Важно: worker НЕ имеет доступа к WorldState и не мутирует его.

import type { DecisionRequest, DecisionResult } from "./types";
import type { EngineRuntime } from "./runtime";

export type ExecuteDecision = (req: DecisionRequest) => Promise<DecisionResult>;

export function startDecisionWorker(
  runtime: EngineRuntime,
  execute: ExecuteDecision,
  opts?: { intervalMs?: number; getTick?: () => number }
): { stop: () => void } {
  const intervalMs = opts?.intervalMs ?? 50;
  const getTick = opts?.getTick ?? (() => 0);

  let stopped = false;
  let runningCount = 0;

  const handle = setInterval(async () => {
    if (stopped) return;
    if (runtime.queue.length === 0) return;

    const available = runtime.maxConcurrentRequestsTotal - runtime.inFlightByAgent.size;
    const allowedToStart = Math.max(0, available);

    while (runningCount < allowedToStart && runtime.queue.length > 0) {
      const req = runtime.queue.shift();
      if (!req) break;

      runningCount++;
      const startMs = Date.now();
      runtime.pushEngineEvents([
        { type: "AI_REQUEST_SENT", tick: getTick(), agentId: req.agentId, requestId: req.requestId },
      ]);
      execute(req)
        .then((result) => {
          // Safety: never push undefined/invalid results silently.
          if (
            !result ||
            typeof result !== "object" ||
            result.requestId !== req.requestId ||
            result.agentId !== req.agentId
          ) {
            runtime.pushEngineEvents([
              {
                type: "AI_REQUEST_FAILED",
                tick: getTick(),
                agentId: req.agentId,
                requestId: req.requestId,
                reason: "invalid_result_shape",
              },
            ]);
            const inflight = runtime.inFlightByAgent.get(req.agentId);
            if (inflight && inflight.requestId === req.requestId) {
              runtime.inFlightByAgent.delete(req.agentId);
            }
            return;
          }

          runtime.pushEngineEvents([
            {
              type: "AI_RESULT_RECEIVED",
              tick: getTick(),
              agentId: req.agentId,
              requestId: req.requestId,
              latencyMs: Date.now() - startMs,
            },
          ]);
          runtime.decisionBuffer.push(result);
        })
        .catch((err) => {
          const reason = err instanceof Error ? err.message : String(err);
          runtime.pushEngineEvents([
            {
              type: "AI_REQUEST_FAILED",
              tick: getTick(),
              agentId: req.agentId,
              requestId: req.requestId,
              reason,
            },
          ]);
          const inflight = runtime.inFlightByAgent.get(req.agentId);
          if (inflight && inflight.requestId === req.requestId) {
            runtime.inFlightByAgent.delete(req.agentId);
          }
        })
        .finally(() => {
          runningCount--;
        });
    }
  }, intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(handle);
    },
  };
}


