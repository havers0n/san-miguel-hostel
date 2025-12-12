// Iter 6: Transactional Tick Pipeline (сердце системы).
// Важно:
// - tick() — чистая функция по world (не хранит world внутри себя)
// - никаких scheduler/async/filterDecisionResults
// - runtime мутируется только drain'ами

// NOTE: временный импорт из legacy world types; позже переедет в src/core/world/types.ts.
import type { AgentDecision, WorldEvent, WorldState } from "../../../types/world";
import { drainCommandBuffer, drainDecisionBuffer } from "./drain";
import { filterDecisionResults } from "./decisions";
import type { EngineRuntime } from "./runtime";
import type { WorldOps } from "../world/ops";
import type { DecisionResult } from "./types";

export function createEngineTick(runtime: EngineRuntime, worldOps: WorldOps): {
  tick(
    world: WorldState,
    simDt: number,
    engineTick: number
  ): { world: WorldState; domainEvents: WorldEvent[]; aiIntents: string[] };
} {
  return {
    tick(world: WorldState, simDt: number, _engineTick: number) {
      const nowMs = worldOps.getNowMs();

      const raw = drainDecisionBuffer(runtime) as unknown as unknown[];
      const rawResults = raw.filter((x): x is DecisionResult => {
        if (!x || typeof x !== "object") return false;
        return (
          "requestId" in x &&
          "agentId" in x &&
          "intentId" in x &&
          "contextHash" in x &&
          "decision" in x
        );
      });

      const getCtx = (agentId: string) => ({
        contextHash: worldOps.getAgentContextHash(world, agentId),
        nowMs,
      });

      const { accepted, events: discardEvents } = filterDecisionResults(
        runtime,
        _engineTick,
        rawResults,
        getCtx
      );
      if (discardEvents.length) runtime.pushEngineEvents(discardEvents);

      // TTL sweep (cheap), no timers.
      if (_engineTick % 60 === 0) runtime.seenIntentIds.sweep(nowMs);

      const { world: world1, events: events1 } = worldOps.applyDecisions(
        world,
        accepted.map((r) => r.decision) as unknown as AgentDecision[]
      );

      const commands = drainCommandBuffer(runtime);
      const { world: world2, events: events2 } = worldOps.reduceCommands(world1, commands);

      const { world: world3, events: events3, aiIntents } = worldOps.step(world2, simDt);

      return {
        world: world3,
        domainEvents: [...events1, ...events2, ...events3],
        aiIntents,
      };
    },
  };
}


