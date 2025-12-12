// Iter 7: decision ingestion filter (exactly-once requestId + intentId TTL + stale context discard).

import type { EngineRuntime } from "./runtime";
import type { DecisionResult, EngineEvent } from "./types";

export function filterDecisionResults(
  runtime: EngineRuntime,
  engineTick: number,
  results: DecisionResult[],
  getCtx: (agentId: string) => { contextHash: string; nowMs: number }
): { accepted: DecisionResult[]; events: EngineEvent[] } {
  const accepted: DecisionResult[] = [];
  const events: EngineEvent[] = [];

  for (const r of results) {
    // 1) exactly-once by requestId
    if (runtime.seenRequestIds.has(r.requestId)) continue;
    runtime.seenRequestIds.add(r.requestId);

    const { contextHash: currentHash, nowMs } = getCtx(r.agentId);

    // 2) stale by contextHash
    if (r.contextHash !== currentHash) {
      runtime.metrics.decisionDiscardedTotal++;
      events.push({
        type: "AI_RESULT_DISCARDED",
        tick: engineTick,
        agentId: r.agentId,
        requestId: r.requestId,
        reason: "stale_context",
      });
      continue;
    }

    // 3) exactly-once by intentId (TTL)
    if (runtime.seenIntentIds.has(r.intentId, nowMs)) {
      runtime.metrics.decisionDiscardedTotal++;
      events.push({
        type: "AI_RESULT_DISCARDED",
        tick: engineTick,
        agentId: r.agentId,
        requestId: r.requestId,
        reason: "duplicate_intent_ttl",
      });
      continue;
    }

    runtime.seenIntentIds.add(r.intentId, nowMs);
    accepted.push(r);
  }

  return { accepted, events };
}


