// Iter 5: WorldOps adapter поверх текущего мира (делегирование в существующие модули).
// Важно: это НЕ подключено к engine loop/App.tsx и НЕ меняет логику симуляции.

import type { AgentDecision, WorldEvent, WorldState } from "../../../types/world";
import { commandMoveAgent, moveAgentToRoom, applyAgentDecision, stepMockWorld } from "../../../mock/worldMock";

// Локальный минимальный тип команды: world-адаптер не должен зависеть от engine-слоя.
type Command = {
  id: string;
  type: string;
  createdAtMs: number;
  actorId?: string;
  payload: unknown;
};

export interface WorldOps {
  getAgentContextHash(world: WorldState, agentId: string): string;
  getNowMs(): number;
  applyDecisions(world: WorldState, decisions: AgentDecision[]): { world: WorldState; events: WorldEvent[] };
  reduceCommands(world: WorldState, commands: Command[]): { world: WorldState; events: WorldEvent[] };
  step(world: WorldState, simDt: number): { world: WorldState; events: WorldEvent[]; aiIntents: string[] };
}

function fnv1a32(input: string): string {
  // Minimal deterministic hash, no deps.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619 (FNV prime) with 32-bit overflow
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function quantize(n: number, step: number): number {
  return Math.round(n / step) * step;
}

export function createWorldOps(opts?: { nowMs?: () => number }): WorldOps {
  const now = opts?.nowMs ?? (() => Date.now());
  return {
    getAgentContextHash(world, agentId) {
      const agent = world.agents.find((a) => a.id === agentId);
      if (!agent) return `missing:${agentId}`;

      const snapshot = {
        agentId: agent.id,
        roomId: agent.roomId,
        pos: {
          x: quantize(agent.position.x, 0.25),
          y: quantize(agent.position.y, 0.25),
          z: quantize(agent.position.z, 0.25),
        },
        state: agent.state,
        memoryRevision: (agent as any).memoryRevision ?? 0,
        worldRevision: (agent as any).worldRevision ?? 0,
        perceptsRevision: (agent as any).perceptsRevision ?? 0,
      };

      return fnv1a32(JSON.stringify(snapshot));
    },

    getNowMs() {
      return now();
    },

    applyDecisions(world, decisions) {
      let next = world;
      const startLen = world.events.length;
      for (const d of decisions) {
        next = applyAgentDecision(next, d);
      }
      const endLen = next.events.length;
      const delta = endLen >= startLen ? next.events.slice(startLen) : [];
      return { world: next, events: delta };
    },

    reduceCommands(world, commands) {
      // Тонкие обёртки над уже существующими “ручными” командами, без добавления событий.
      let next = world;
      for (const cmd of commands) {
        if (cmd.type === "MOVE_TO_POINT") {
          const payload = cmd.payload as any;
          const agentId = (payload?.agentId ?? cmd.actorId) as string | undefined;
          const x = payload?.x;
          const z = payload?.z;
          if (typeof agentId === "string" && Number.isFinite(x) && Number.isFinite(z)) {
            const agents = commandMoveAgent(agentId, x, z, next);
            next = { ...next, agents };
          }
          continue;
        }
        if (cmd.type === "MOVE_TO_ROOM") {
          const payload = cmd.payload as any;
          const agentId = (payload?.agentId ?? cmd.actorId) as string | undefined;
          const roomId = payload?.roomId;
          if (typeof agentId === "string" && typeof roomId === "string") {
            next = moveAgentToRoom(agentId, roomId, next);
          }
          continue;
        }
        // Unknown command types: ignore (no-op) in this iteration.
      }
      return { world: next, events: [] };
    },

    step(world, simDt) {
      const next = stepMockWorld(world, simDt);
      const startLen = world.events.length;
      const endLen = next.events.length;
      const delta = endLen >= startLen ? next.events.slice(startLen) : [];
      return {
        world: next,
        events: delta,
        aiIntents: next.agentsNeedingDecision ?? [],
      };
    },
  };
}


