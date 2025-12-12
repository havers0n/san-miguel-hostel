// Iter 8: SchedulerAPI (write-allowlist поверх EngineRuntime).
// Scheduler должен мутировать runtime только через этот API.

import type { DecisionRequest, EngineMetrics, InFlight } from "./types";
import type { EngineRuntime } from "./runtime";
import { enqueueWithFairBackpressure } from "./queue";

export type SchedulerAPI = {
  // write allowlist
  enqueue(req: DecisionRequest): boolean;
  setInFlight(agentId: string, inFlight: InFlight): void;
  clearInFlight(agentId: string): void;
  metrics: EngineMetrics;

  // read helpers (не дают дополнительных мутаций)
  hasInFlight(agentId: string): boolean;
  inFlightCount(): number;
  maxConcurrentRequestsTotal: number;
};

export function makeSchedulerAPI(
  runtime: EngineRuntime,
  getTick: () => number
): SchedulerAPI {
  return {
    enqueue(req) {
      // enqueueWithFairBackpressure сам пушит AI_BACKPRESSURE event и инкрементит метрики.
      const { enqueued, dropped } = enqueueWithFairBackpressure(runtime, getTick(), req);
      // Важно для inFlight lifecycle:
      // enqueueWithFairBackpressure может выкинуть (dropped) самый старый request (того же агента или глобально).
      // Если dropped оказался чужим агентом, его inFlight lock должен быть освобождён, иначе агент зависнет до timeout.
      if (dropped) {
        const inflight = runtime.inFlightByAgent.get(dropped.agentId);
        if (inflight && inflight.requestId === dropped.requestId) {
          runtime.inFlightByAgent.delete(dropped.agentId);
        }
      }
      return enqueued;
    },
    setInFlight(agentId, inFlight) {
      runtime.inFlightByAgent.set(agentId, inFlight);
    },
    clearInFlight(agentId) {
      runtime.inFlightByAgent.delete(agentId);
    },
    metrics: runtime.metrics,

    hasInFlight(agentId) {
      return runtime.inFlightByAgent.has(agentId);
    },
    inFlightCount() {
      return runtime.inFlightByAgent.size;
    },
    maxConcurrentRequestsTotal: runtime.maxConcurrentRequestsTotal,
  };
}


