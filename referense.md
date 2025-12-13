Ниже — референс-костяк (TypeScript) для: типы, runtime, TTL, drain’ы, backpressure fairness, fixed-step loop, контракты scheduler/proxy. Это можно прямо вставлять в репо и итеративно наполнять.

1) Типы: события, команды, решения
// engine/types.ts
export type Tick = number;

export type WorldEvent =
  | { type: "SIM_DROPPED_TICKS"; tick: Tick; dropped: number }
  | { type: "AI_BACKPRESSURE"; tick: Tick; agentId: string; droppedIntentId?: string }
  | { type: "COMMAND_REJECTED"; tick: Tick; commandId: string; reason: string }
  | { type: "AI_RESULT_DISCARDED"; tick: Tick; agentId: string; requestId: string; reason: string }
  | { type: string; [k: string]: any }; // расширяем

export type Command = {
  id: string;
  type: string;
  createdAtMs: number;
  actorId?: string;
  payload: unknown;
};

export type DecideContext = {
  agentId: string;
  roomId: string;
  state: string;
  needs?: { energy?: number; hunger?: number; anxiety?: number; aggression?: number };
  nearbyAgents?: Array<{ id: string; role?: string; dist?: number; state?: string }>;
  rooms?: Array<{ id: string; name?: string }>;
  allowlistActions: string[];
};

export type DecisionRequest = {
  requestId: string;     // уникальный сетевой запрос
  agentId: string;
  intentId: string;      // agentId:contextHash
  contextHash: string;
  createdAtMs: number;
  promptVersion: string; // константа-строка (пока)
  ttlMs: number;         // например 20000
  context: DecideContext;
};

export type DecisionResult = {
  requestId: string;
  agentId: string;
  intentId: string;
  contextHash: string;
  createdAtMs: number;
  decisionSchemaVersion: 1;
  decision: unknown;     // после валидатора/нормализации
};

2) TTL-множество для intentId (короткое, дешёвое)
// engine/ttl.ts
export class TTLSet {
  private map = new Map<string, number>(); // key -> expireAtMs

  constructor(private defaultTtlMs: number) {}

  has(key: string, nowMs: number): boolean {
    const exp = this.map.get(key);
    if (exp == null) return false;
    if (exp <= nowMs) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  add(key: string, nowMs: number, ttlMs?: number) {
    this.map.set(key, nowMs + (ttlMs ?? this.defaultTtlMs));
  }

  sweep(nowMs: number) {
    // простая уборка; вызывай раз в N тиков
    for (const [k, exp] of this.map) if (exp <= nowMs) this.map.delete(k);
  }

  size() { return this.map.size; }
}

3) Runtime: bounded буферы + allowlist scheduler мутирует только это
// engine/runtime.ts
import { Command, DecisionRequest, DecisionResult, WorldEvent } from "./types";
import { TTLSet } from "./ttl";

export type InFlight = {
  requestId: string;
  intentId: string;
  agentId: string;
  startedAtMs: number;
};

export type EngineMetrics = {
  droppedTicksTotal: number;
  backpressureDropsTotal: number;
  decisionDiscardedTotal: number;
};

export class EngineRuntime {
  // буферы (пишут разные подсистемы)
  decisionBuffer: DecisionResult[] = [];
  commandBuffer: Command[] = [];

  // exactly-once
  seenRequestIds = new Set<string>();
  seenIntentIds = new TTLSet(20_000);

  // scheduler state
  queue: DecisionRequest[] = [];
  inFlightByAgent = new Map<string, InFlight>();

  // лимиты
  maxConcurrentRequestsTotal = 3;
  maxQueueSize = 100;

  // метрики
  metrics: EngineMetrics = {
    droppedTicksTotal: 0,
    backpressureDropsTotal: 0,
    decisionDiscardedTotal: 0,
  };

  // events ring — можешь держать тут или в world (но bounded)
  eventsRing: WorldEvent[] = [];
  eventsRingMax = 1000;

  pushEvents(events: WorldEvent[]) {
    for (const e of events) {
      this.eventsRing.push(e);
      if (this.eventsRing.length > this.eventsRingMax) this.eventsRing.shift();
    }
  }
}


Scheduler должен получать только ссылку на runtime и соблюдать allowlist. Чтобы не “на словах” — можно дать ему API-объект вместо полного runtime (см. ниже).

4) Drain’ы: атомарные snapshot boundary
// engine/drain.ts
import { EngineRuntime } from "./runtime";
import { DecisionResult, Command } from "./types";

export function drainDecisionBuffer(runtime: EngineRuntime): DecisionResult[] {
  const buf = runtime.decisionBuffer;
  if (buf.length === 0) return [];
  runtime.decisionBuffer = []; // атомарный swap

  return buf;
}

export function drainCommandBuffer(runtime: EngineRuntime): Command[] {
  const buf = runtime.commandBuffer;
  if (buf.length === 0) return [];
  runtime.commandBuffer = []; // атомарный swap
  return buf;
}

5) Exactly-once + stale policy (requestId + intentId + TTL + contextHash)
// engine/decisions.ts
import { EngineRuntime } from "./runtime";
import { DecisionResult, Tick, WorldEvent } from "./types";

// world должен уметь сказать "текущий contextHash агента" + время
export type ContextResolver = (agentId: string) => { contextHash: string; nowMs: number };

export function filterDecisionResults(
  runtime: EngineRuntime,
  tick: Tick,
  results: DecisionResult[],
  getCtx: ContextResolver,
): { accepted: DecisionResult[]; events: WorldEvent[] } {
  const accepted: DecisionResult[] = [];
  const events: WorldEvent[] = [];

  for (const r of results) {
    // 1) дубликат по requestId
    if (runtime.seenRequestIds.has(r.requestId)) continue;
    runtime.seenRequestIds.add(r.requestId);

    const { contextHash: currentHash, nowMs } = getCtx(r.agentId);

    // 2) stale по contextHash
    if (r.contextHash !== currentHash) {
      runtime.metrics.decisionDiscardedTotal++;
      events.push({ type: "AI_RESULT_DISCARDED", tick, agentId: r.agentId, requestId: r.requestId, reason: "stale_context" });
      continue;
    }

    // 3) exactly-once по intentId (TTL)
    if (runtime.seenIntentIds.has(r.intentId, nowMs)) {
      runtime.metrics.decisionDiscardedTotal++;
      events.push({ type: "AI_RESULT_DISCARDED", tick, agentId: r.agentId, requestId: r.requestId, reason: "duplicate_intent_ttl" });
      continue;
    }

    runtime.seenIntentIds.add(r.intentId, nowMs);
    accepted.push(r);
  }

  return { accepted, events };
}


TTL sweep делай раз в ~60 тиков.

6) Backpressure fairness: drop same-agent oldest
// engine/queue.ts
import { EngineRuntime } from "./runtime";
import { DecisionRequest, Tick, WorldEvent } from "./types";

export function enqueueWithFairBackpressure(
  runtime: EngineRuntime,
  tick: Tick,
  req: DecisionRequest
): { dropped?: DecisionRequest; events?: WorldEvent[] } {
  if (runtime.queue.length < runtime.maxQueueSize) {
    runtime.queue.push(req);
    return {};
  }

  // 1) drop oldest of same agent
  const idx = runtime.queue.findIndex(q => q.agentId === req.agentId);
  let dropped: DecisionRequest | undefined;

  if (idx >= 0) dropped = runtime.queue.splice(idx, 1)[0];
  else dropped = runtime.queue.shift();

  runtime.queue.push(req);

  runtime.metrics.backpressureDropsTotal++;
  const events: WorldEvent[] = [{
    type: "AI_BACKPRESSURE",
    tick,
    agentId: req.agentId,
    droppedIntentId: dropped?.intentId
  }];

  return { dropped, events };
}

7) EngineLoop: MAX_ACCUM + SIM_DROPPED_TICKS
// engine/loop.ts
import { EngineRuntime } from "./runtime";
import { Tick, WorldEvent } from "./types";

export type TickFn = (simDt: number) => void;

export class EngineLoop {
  engineTick: Tick = 0;
  accumulator = 0;

  readonly SIM_DT = 1 / 30;
  readonly MAX_TICKS_PER_FRAME = 5;
  readonly MAX_ACCUM = this.SIM_DT * this.MAX_TICKS_PER_FRAME;

  constructor(private runtime: EngineRuntime, private tickFn: TickFn) {}

  frame(realDtSec: number) {
    this.accumulator += realDtSec;

    if (this.accumulator > this.MAX_ACCUM) {
      const dropped = Math.floor((this.accumulator - this.MAX_ACCUM) / this.SIM_DT);
      this.accumulator = this.MAX_ACCUM;

      this.runtime.metrics.droppedTicksTotal += dropped;

      const e: WorldEvent = { type: "SIM_DROPPED_TICKS", tick: this.engineTick, dropped };
      this.runtime.pushEvents([e]);
    }

    let ticksThisFrame = 0;
    while (this.accumulator >= this.SIM_DT && ticksThisFrame < this.MAX_TICKS_PER_FRAME) {
      this.tickFn(this.SIM_DT);
      this.accumulator -= this.SIM_DT;
      this.engineTick++;
      ticksThisFrame++;
    }
  }
}

8) Важная защита: Scheduler получает API-объект, а не весь runtime

Иначе “случайно” начнёшь писать куда нельзя.

// engine/scheduler_api.ts
import { DecisionRequest } from "./types";
import { EngineRuntime } from "./runtime";
import { enqueueWithFairBackpressure } from "./queue";

export type SchedulerAPI = {
  enqueue(req: DecisionRequest): void;
  setInFlight(agentId: string, inFlight: EngineRuntime["inFlightByAgent"] extends Map<string, infer T> ? T : never): void;
  clearInFlight(agentId: string): void;
  metrics: EngineRuntime["metrics"];
};

export function makeSchedulerAPI(runtime: EngineRuntime, getTick: () => number): SchedulerAPI {
  return {
    enqueue(req) {
      const { events } = enqueueWithFairBackpressure(runtime, getTick(), req);
      if (events?.length) runtime.pushEvents(events);
    },
    setInFlight(agentId, inflight) { runtime.inFlightByAgent.set(agentId, inflight as any); },
    clearInFlight(agentId) { runtime.inFlightByAgent.delete(agentId); },
    metrics: runtime.metrics,
  };
}

9) Твой транзакционный tick: как связать всё вместе (скелет)

Тут “мир” у тебя свой, поэтому я обозначу интерфейсы.

// engine/tick.ts
import { EngineRuntime } from "./runtime";
import { drainCommandBuffer, drainDecisionBuffer } from "./drain";
import { filterDecisionResults } from "./decisions";
import { Tick } from "./types";

// world интерфейс (адаптируешь под свой WorldState)
export type WorldState = any;

export type WorldOps = {
  getAgentContextHash(world: WorldState, agentId: string): string;
  getNowMs(): number;

  applyDecisions(world: WorldState, decisions: any[]): { world: WorldState; events: any[] };
  reduceCommands(world: WorldState, commands: any[]): { world: WorldState; events: any[] };

  step(world: WorldState, simDt: number): { world: WorldState; events: any[]; aiIntents: any[] };
};

export type Scheduler = {
  tick(aiIntents: any[], world: WorldState, runtimeApi: any): void;
};

export function makeTick(
  runtime: EngineRuntime,
  ops: WorldOps,
  scheduler: Scheduler,
  getRuntimeApi: () => any,
) {
  let world: WorldState;

  const setWorld = (w: WorldState) => (world = w);
  const getWorld = () => world;

  const tick = (simDt: number, engineTick: Tick) => {
    // drain decisions
    const rawResults = drainDecisionBuffer(runtime);
    const { accepted, events: discards } = filterDecisionResults(
      runtime,
      engineTick,
      rawResults,
      (agentId) => ({ contextHash: ops.getAgentContextHash(world, agentId), nowMs: ops.getNowMs() }),
    );

    // apply decisions
    const a1 = ops.applyDecisions(world, accepted);
    // drain commands
    const cmds = drainCommandBuffer(runtime);
    const a2 = ops.reduceCommands(a1.world, cmds);
    // step
    const a3 = ops.step(a2.world, simDt);

    // scheduler (runtime only)
    scheduler.tick(a3.aiIntents, a3.world, getRuntimeApi());

    // events bounded
    runtime.pushEvents([...discards, ...a1.events, ...a2.events, ...a3.events]);
    world = a3.world;
  };

  return { tick, setWorld, getWorld };
}
