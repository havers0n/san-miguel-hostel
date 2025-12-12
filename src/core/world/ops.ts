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
  // Iter 13: synchronous, minimal context for AI proxy (must be serializable, stable-ish, and small).
  getAgentDecisionContext(
    world: WorldState,
    agentId: string,
    allowlistActions: string[]
  ): {
    agentId: string;
    roomId: string;
    state: string;
    needs?: { energy?: number; hunger?: number; anxiety?: number; aggression?: number };
    nearbyAgents?: Array<{ id: string; role?: string; dist?: number; state?: string }>;
    rooms?: Array<{ id: string; name?: string }>;
    allowlistActions: string[];
  };
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

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
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

    getAgentDecisionContext(world, agentId, allowlistActions) {
      const agent = world.agents.find((a) => a.id === agentId);
      // Scheduler guards missing agents and should not call this for invalid ids.
      // Still, keep this safe and non-throwing to avoid breaking tick().
      if (!agent) {
        return {
          agentId,
          roomId: "",
          state: "",
          allowlistActions: [...allowlistActions],
        };
      }

      // Rooms: stable ordering by id for determinism/debuggability.
      const rooms = [...world.rooms]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((r) => ({ id: r.id, name: r.name }));

      // Nearby agents: same room, sorted by distance then id; bounded.
      const NEARBY_LIMIT = 8;
      const nearbyAgents = world.agents
        .filter((a) => a.id !== agent.id && a.roomId === agent.roomId)
        .map((a) => {
          const dx = a.position.x - agent.position.x;
          const dz = a.position.z - agent.position.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          return {
            id: a.id,
            role: a.role,
            dist: round2(dist),
            state: a.state,
          };
        })
        .sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0) || a.id.localeCompare(b.id))
        .slice(0, NEARBY_LIMIT);

      return {
        agentId: agent.id,
        roomId: agent.roomId,
        state: agent.state,
        needs: {
          energy: round2(clamp01(agent.energy)),
          hunger: round2(clamp01(agent.hunger)),
          anxiety: round2(clamp01(agent.anxiety)),
          aggression: round2(clamp01(agent.aggression)),
        },
        nearbyAgents,
        rooms,
        // Copy to avoid accidental shared reference leaks.
        allowlistActions: [...allowlistActions],
      };
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


