// Iter 6: Transactional Tick Pipeline (сердце системы).
// Важно:
// - tick() — чистая функция по world (не хранит world внутри себя)
// - никаких scheduler/async/filterDecisionResults
// - runtime мутируется только drain'ами

// NOTE: временный импорт из legacy world types; позже переедет в src/core/world/types.ts.
import type { AgentDecision, WorldEvent, WorldState } from "../../../types/world";
import { drainCommandBuffer, drainDecisionBuffer } from "./drain";
import type { EngineRuntime } from "./runtime";
import type { WorldOps } from "../world/ops";

export function createEngineTick(runtime: EngineRuntime, worldOps: WorldOps): {
  tick(
    world: WorldState,
    simDt: number,
    engineTick: number
  ): { world: WorldState; domainEvents: WorldEvent[]; aiIntents: string[] };
} {
  return {
    tick(world: WorldState, simDt: number, _engineTick: number) {
      const rawResults = drainDecisionBuffer(runtime);
      // TODO(iter7): decisionBuffer will hold DecisionResult; apply after filter+validation instead of casting.
      const { world: world1, events: events1 } = worldOps.applyDecisions(
        world,
        rawResults as unknown as AgentDecision[]
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


