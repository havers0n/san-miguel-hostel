// Iter 8: Scheduler (планирование aiIntents в DecisionRequest очередь), без сети/async.

import type { WorldState } from "../../../types/world";
import type { DecisionRequest, InFlight } from "./types";
import type { SchedulerAPI } from "./scheduler_api";
import type { WorldOps } from "../world/ops";

export type SchedulerConfig = {
  promptVersion: string;
  ttlMs: number;
  cooldownMs: number;
  // Iter 13: allowlist is part of the minimal decision context (server validates action ∈ allowlist).
  allowlistActions: string[];
  // Iter 12.3: allow deterministic requestId generation (headless).
  // If not provided, falls back to crypto.randomUUID/getRandomValues/legacy fallback.
  requestIdFactory?: (input: {
    seq: number;
    agentId: string;
    intentId: string;
    contextHash: string;
    createdAtMs: number;
    promptVersion: string;
  }) => string;
};

export type Scheduler = {
  tick(aiIntents: string[], world: WorldState, api: SchedulerAPI, nowMs: number): void;
};

function randomUUIDFallback(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    // RFC 4122 v4
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last resort: uniqueness best-effort (non-crypto).
  return `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createScheduler(worldOps: WorldOps, config: SchedulerConfig): Scheduler {
  const lastEnqueuedAtMsByAgent = new Map<string, number>();
  let seq = 0;

  return {
    tick(aiIntents, world, api, nowMs) {
      // Global concurrency limit
      if (api.inFlightCount() >= api.maxConcurrentRequestsTotal) return;

      for (const agentId of aiIntents) {
        if (api.inFlightCount() >= api.maxConcurrentRequestsTotal) break;
        if (api.hasInFlight(agentId)) continue;

        const lastMs = lastEnqueuedAtMsByAgent.get(agentId);
        if (lastMs != null && nowMs - lastMs < config.cooldownMs) continue;

        const contextHash = worldOps.getAgentContextHash(world, agentId);
        // Guard against invalid agent ids (shouldn't happen, but scheduler must not throw).
        if (contextHash.startsWith("missing:")) continue;
        const intentId = `${agentId}:${contextHash}`;

        const req: DecisionRequest = {
          requestId:
            config.requestIdFactory?.({
              seq: seq++,
              agentId,
              intentId,
              contextHash,
              createdAtMs: nowMs,
              promptVersion: config.promptVersion,
            }) ?? randomUUIDFallback(),
          agentId,
          intentId,
          contextHash,
          createdAtMs: nowMs,
          promptVersion: config.promptVersion,
          ttlMs: config.ttlMs,
          context: worldOps.getAgentDecisionContext(world, agentId, config.allowlistActions),
        };

        const enqueued = api.enqueue(req);
        if (!enqueued) continue;

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


