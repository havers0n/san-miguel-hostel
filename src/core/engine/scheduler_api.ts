// Iter 8: SchedulerAPI (write-allowlist поверх EngineRuntime).
// Scheduler должен мутировать runtime только через этот API.

import type { DecisionRequest, EngineMetrics, InFlight } from "./types";
import type { EngineRuntime } from "./runtime";
import { enqueueWithFairBackpressure } from "./queue";

export type SchedulerAPI = {
  // write allowlist
  enqueue(req: DecisionRequest): void;
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
      enqueueWithFairBackpressure(runtime, getTick(), req);
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


