// Iter 12.3: deterministic headless worker (без таймеров, без доступа к WorldState).
// Цель: воспроизводимо проверять backpressure fairness, inFlight lifecycle, stale/dup discards, concurrency.

import type { EngineRuntime } from "./runtime";
import type { DecisionRequest, DecisionResult } from "./types";

export type DeterministicExecute = (req: DecisionRequest) => DecisionResult[];

type Pending = {
  req: DecisionRequest;
  remainingMs: number;
  results: DecisionResult[];
};

export class DeterministicHeadlessWorker {
  private pending: Pending[] = [];

  constructor(
    private runtime: EngineRuntime,
    private execute: DeterministicExecute,
    private opts?: {
      // Базовая латентность (может быть 0), детерминированно модифицируемая внутри headless-run.
      baseLatencyMs?: number;
    }
  ) {}

  // Для проверок inFlight lifecycle в headless-run
  pendingRequests(): DecisionRequest[] {
    return this.pending.map((p) => p.req);
  }

  step(deltaMs: number, latencyMsForReq?: (req: DecisionRequest) => number): void {
    // 1) advance time & complete finished
    if (deltaMs > 0) {
      for (const p of this.pending) p.remainingMs -= deltaMs;
    }

    if (this.pending.length > 0) {
      const still: Pending[] = [];
      for (const p of this.pending) {
        if (p.remainingMs <= 0) {
          // deterministic: emit in insertion order
          for (const r of p.results) this.runtime.decisionBuffer.push(r);
        } else {
          still.push(p);
        }
      }
      this.pending = still;
    }

    // 2) start new work up to concurrency limit
    while (
      this.pending.length < this.runtime.maxConcurrentRequestsTotal &&
      this.runtime.queue.length > 0
    ) {
      const req = this.runtime.queue.shift();
      if (!req) break;

      const results = this.execute(req);
      const latency =
        latencyMsForReq?.(req) ?? this.opts?.baseLatencyMs ?? 0;

      this.pending.push({
        req,
        remainingMs: latency,
        results,
      });
    }
  }
}


