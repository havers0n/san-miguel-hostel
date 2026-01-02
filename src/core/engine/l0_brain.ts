// Iter L0: детерминированный L0 Brain для локального executor
// Логика принятия решений вынесена из UI компонента для тестируемости и расширяемости.

import type { DecisionRequest } from "./types";
import type { AgentDecision } from "../../../types/world";

// Конфиг "знаний" L0-мозга о мире.
// Вынесено сюда, чтобы при смене карты менять только в одном месте.
export const DEFAULT_L0_WORLD_MAP = {
  DORM_A: "r1",
  DORM_B: "r2",
  KITCHEN: "r4",
} as const;

export type L0WorldMap = typeof DEFAULT_L0_WORLD_MAP;

// Пороги для принятия решений
const L0_THRESHOLDS = {
  ENERGY_REST: 0.25,      // Если energy < 0.25 → REST
  HUNGER_EAT: 0.75,       // Если hunger > 0.75 → EAT
  TALK_CHANCE_PERCENT: 30, // Вероятность TALK (детерминированная)
} as const;

// Deterministic 32-bit FNV-1a hash
// ВАЖНО: для agentId/requestId (обычно UUID/ASCII) это детерминировано.
function fnv1a32u(str: string): number {
  let h = 0x811c9dc5; // 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // 16777619
  }
  return h >>> 0;
}

// Использует Set для O(1) проверки вместо O(n) allow.includes()
function pickFirstAllowed(allow: string[], preferred: string[]): string {
  const allowSet = new Set(allow);
  for (const a of preferred) if (allowSet.has(a)) return a;
  // Детерминированный fallback: сортированный allow[0]
  return allow.length > 0 ? allow[0] : "IDLE";
}

function hasRoom(rooms: Array<{ id: string }> | undefined, id: string): boolean {
  if (!rooms) return true; // если rooms не передают — не блокируем
  return rooms.some((r) => r.id === id);
}

function chooseDorm(agentId: string, cfg: L0WorldMap): "r1" | "r2" {
  return (fnv1a32u(agentId) % 2) === 0 ? cfg.DORM_A : cfg.DORM_B;
}

// Динамический поиск комнаты по имени (fallback для устойчивости к изменениям ID)
// ВАЖНО: Assumes rooms array order is deterministic (world generation is deterministic).
// Если порядок не гарантирован, .find() может вернуть нестабильный результат.
function findRoomByName(rooms: Array<{ id: string; name?: string }> | undefined, namePattern: string): string | null {
  if (!rooms) return null;
  const found = rooms.find(r => r.name?.toLowerCase().includes(namePattern.toLowerCase()));
  return found?.id ?? null;
}

// Финальная проверка: если action не в allowlist → IDLE (анти-флейк защита)
function sanitizeDecision(decision: AgentDecision, allowSet: Set<string>, rooms?: Array<{ id: string }>): AgentDecision {
  if (!allowSet.has(decision.action)) {
    return {
      ...decision,
      action: "IDLE",
      reason: decision.reason ? `${decision.reason}_sanitized` : "sanitized_invalid_action",
    };
  }
  
  // Проверка targetRoomId: если указана комната, которой нет в списке — убираем
  if (decision.targetRoomId && rooms) {
    if (!hasRoom(rooms, decision.targetRoomId)) {
      return {
        ...decision,
        targetRoomId: undefined,
        reason: decision.reason ? `${decision.reason}_invalid_room` : "invalid_room_removed",
      };
    }
  }
  
  return decision;
}

export function makeL0BrainDecision(
  req: DecisionRequest,
  seed: number,
  cfg: L0WorldMap = DEFAULT_L0_WORLD_MAP
): AgentDecision {
  const ctx = req.context;
  
  // АНТИ-ФЛЕЙК: детерминированная сортировка allowlist для стабильного fallback
  const allow = [...(ctx.allowlistActions ?? [])].slice().sort();
  const allowSet = new Set(allow); // O(1) проверки вместо O(n)
  
  // hard fallback если allowlist пуст
  if (allow.length === 0) {
    return {
      agentId: req.agentId,
      tickPlanned: 0,
      action: "IDLE",
      reason: "l0_empty_allowlist",
    };
  }
  
  const energy = ctx.needs?.energy;   // 0..1
  const hunger = ctx.needs?.hunger;   // 0..1
  const roomId = ctx.roomId;
  const rooms = ctx.rooms;
  
  // Используем конфиг вместо магических строк
  const dormA = cfg.DORM_A;
  const dormB = cfg.DORM_B;
  
  // Динамический поиск кухни (fallback на конфиг)
  const kitchen = findRoomByName(rooms, "kitchen") ?? cfg.KITCHEN;
  const dormTarget = chooseDorm(req.agentId, cfg);
  
  // TypeScript strictness: явно указываем undefined для защиты от использования до присвоения
  let decision: AgentDecision | undefined;
  
  // 1) REST priority
  if (typeof energy === "number" && energy < L0_THRESHOLDS.ENERGY_REST) {
    const restAction = pickFirstAllowed(allow, ["REST_IN_DORM", "REST", "IDLE"]);
    const goAction = pickFirstAllowed(allow, ["GO_TO_ROOM", "MOVE_TO_ROOM"]);
    
    // если мы не в спальне — пытаемся идти в спальню
    if (roomId !== dormA && roomId !== dormB) {
      const target = hasRoom(rooms, dormTarget) ? dormTarget : (hasRoom(rooms, dormA) ? dormA : dormB);
      if (goAction === "GO_TO_ROOM" || goAction === "MOVE_TO_ROOM") {
        decision = {
          agentId: req.agentId,
          tickPlanned: 0,
          action: goAction,
          targetRoomId: target,
          reason: `l0_rest_go_dorm (en=${energy.toFixed(2)}, target=${target})`,
        };
      } else {
        // Если не можем переместиться — отдыхаем прямо сейчас (деградация)
        decision = {
          agentId: req.agentId,
          tickPlanned: 0,
          action: restAction,
          reason: `l0_rest_no_move_capability (en=${energy.toFixed(2)})`,
        };
      }
    } else {
      // уже в спальне — отдыхаем
      decision = {
        agentId: req.agentId,
        tickPlanned: 0,
        action: restAction,
        reason: `l0_rest (en=${energy.toFixed(2)}, room=${roomId})`,
      };
    }
  }
  // 2) EAT priority
  else if (typeof hunger === "number" && hunger > L0_THRESHOLDS.HUNGER_EAT) {
    const eatAction = pickFirstAllowed(allow, ["EAT_IN_KITCHEN", "EAT", "IDLE"]);
    const goAction = pickFirstAllowed(allow, ["GO_TO_ROOM", "MOVE_TO_ROOM"]);
    
    if (roomId !== kitchen) {
      if (hasRoom(rooms, kitchen) && (goAction === "GO_TO_ROOM" || goAction === "MOVE_TO_ROOM")) {
        decision = {
          agentId: req.agentId,
          tickPlanned: 0,
          action: goAction,
          targetRoomId: kitchen,
          reason: `l0_eat_go_kitchen (hunger=${hunger.toFixed(2)}, target=${kitchen})`,
        };
      } else {
        // Если не можем переместиться — едим прямо сейчас (деградация)
        decision = {
          agentId: req.agentId,
          tickPlanned: 0,
          action: eatAction,
          reason: `l0_eat_no_move_capability (hunger=${hunger.toFixed(2)})`,
        };
      }
    } else {
      decision = {
        agentId: req.agentId,
        tickPlanned: 0,
        action: eatAction,
        reason: `l0_eat (hunger=${hunger.toFixed(2)}, room=${roomId})`,
      };
    }
  }
  // 3) TALK (deterministic chance)
  else {
    // АНТИ-ФЛЕЙК: гарантированная сортировка для детерминизма
    const near = [...(ctx.nearbyAgents ?? [])].sort((a, b) => a.id.localeCompare(b.id));
    
    if (near.length > 0) {
      const roll = (fnv1a32u(`${seed}:${req.requestId}`) % 100);
      if (roll < L0_THRESHOLDS.TALK_CHANCE_PERCENT && allowSet.has("TALK_TO_AGENT")) {
        // Выбираем первого из отсортированного списка (детерминированно)
        const target = near[0]?.id;
        if (target) {
          decision = {
            agentId: req.agentId,
            tickPlanned: 0,
            action: "TALK_TO_AGENT",
            targetAgentId: target,
            reason: `l0_talk (roll=${roll}, target=${target}, near=${near.length})`,
          };
        }
      }
    }
    
    // 4) default WANDER/IDLE
    if (!decision) {
      const action = pickFirstAllowed(allow, ["WANDER", "IDLE"]);
      decision = {
        agentId: req.agentId,
        tickPlanned: 0,
        action,
        reason: `l0_default (en=${energy?.toFixed(2) ?? "?"}, hunger=${hunger?.toFixed(2) ?? "?"}, near=${near.length})`,
      };
    }
  }
  
  // TypeScript strictness: decision гарантированно присвоен на этом этапе
  // Финальная sanitize защита
  return sanitizeDecision(decision, allowSet, rooms);
}

