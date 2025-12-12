// Iter 8: Scheduler (планирование aiIntents в DecisionRequest очередь), без сети/async.

import type { WorldState } from "../../../types/world";
import type { DecisionRequest, InFlight } from "./types";
import type { SchedulerAPI } from "./scheduler_api";
import type { WorldOps } from "../world/ops";

export type SchedulerConfig = {
  promptVersion: string;
  ttlMs: number;
  cooldownMs: number;
};

export type Scheduler = {
  tick(aiIntents: string[], world: WorldState, api: SchedulerAPI): void;
};

export function createScheduler(worldOps: WorldOps, config: SchedulerConfig): Scheduler {
  const lastEnqueuedAtMsByAgent = new Map<string, number>();

  return {
    tick(aiIntents, world, api) {
      const nowMs = worldOps.getNowMs();

      // Global concurrency limit
      if (api.inFlightCount() >= api.maxConcurrentRequestsTotal) return;

      for (const agentId of aiIntents) {
        if (api.inFlightCount() >= api.maxConcurrentRequestsTotal) break;
        if (api.hasInFlight(agentId)) continue;

        const lastMs = lastEnqueuedAtMsByAgent.get(agentId);
        if (lastMs != null && nowMs - lastMs < config.cooldownMs) continue;

        const contextHash = worldOps.getAgentContextHash(world, agentId);
        const intentId = `${agentId}:${contextHash}`;

        const req: DecisionRequest = {
          requestId: crypto.randomUUID(),
          agentId,
          intentId,
          contextHash,
          createdAtMs: nowMs,
          promptVersion: config.promptVersion,
          ttlMs: config.ttlMs,
        };

        api.enqueue(req);

        const inflight: InFlight = {
          requestId: req.requestId,
          intentId: req.intentId,
          agentId: req.agentId,
          startedAtMs: nowMs,
        };
        api.setInFlight(agentId, inflight);
        lastEnqueuedAtMsByAgent.set(agentId, nowMs);
      }
    },
  };
}


