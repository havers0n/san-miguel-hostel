// Iter 2: EngineRuntime (буферы, TTL, метрики, bounded engine-events ring).

import { Command, DecisionRequest, DecisionResult, EngineEvent, EngineMetrics, InFlight } from "./types";
import { TTLSet } from "./ttl";

export class EngineRuntime {
  // Буферы (пишут разные подсистемы; world сюда не пишет).
  decisionBuffer: DecisionResult[] = [];
  commandBuffer: Command[] = [];

  // Exactly-once / anti-dup
  seenRequestIds = new Set<string>();
  // Must cover the full request TTL window to prevent late duplicate results from being accepted.
  // Proxy enforces ttlMs <= 120_000, so using 120s here is safe and conservative.
  seenIntentIds = new TTLSet(120_000);

  // Scheduler state (bounded)
  queue: DecisionRequest[] = [];
  inFlightByAgent = new Map<string, InFlight>();

  // Лимиты (дефолты)
  maxConcurrentRequestsTotal = 3;
  maxQueueSize = 100;

  // Метрики
  metrics: EngineMetrics = {
    droppedTicksTotal: 0,
    backpressureDropsTotal: 0,
    decisionDiscardedTotal: 0,
  };

  // Engine-events ring (bounded; не является доменным WorldEvent).
  eventsRing: EngineEvent[] = [];
  eventsRingMax = 1000;

  pushEngineEvents(events: EngineEvent[]): void {
    for (const e of events) {
      this.eventsRing.push(e);
      if (this.eventsRing.length > this.eventsRingMax) this.eventsRing.shift();
    }
  }
}


