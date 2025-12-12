// Iter 10B: async decision worker transport (без сети/прокси; только runtime queue -> decisionBuffer).
// Важно: worker НЕ имеет доступа к WorldState и не мутирует его.

import type { DecisionRequest, DecisionResult } from "./types";
import type { EngineRuntime } from "./runtime";

export type ExecuteDecision = (req: DecisionRequest) => Promise<DecisionResult>;

export function startDecisionWorker(
  runtime: EngineRuntime,
  execute: ExecuteDecision,
  opts?: { intervalMs?: number }
): { stop: () => void } {
  const intervalMs = opts?.intervalMs ?? 50;

  let stopped = false;
  let inProgress = false;

  const handle = setInterval(async () => {
    if (stopped) return;
    if (inProgress) return;
    if (runtime.queue.length === 0) return;

    const req = runtime.queue.shift();
    if (!req) return;

    inProgress = true;
    try {
      const result = await execute(req);
      runtime.decisionBuffer.push(result);
    } catch {
      runtime.pushEngineEvents([
        {
          type: "AI_RESULT_DISCARDED",
          tick: 0,
          agentId: req.agentId,
          requestId: req.requestId,
          reason: "worker_error",
        },
      ]);
      runtime.inFlightByAgent.delete(req.agentId);
    } finally {
      inProgress = false;
    }
  }, intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(handle);
    },
  };
}


