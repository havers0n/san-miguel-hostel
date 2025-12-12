// Iter 12.2: deterministic world signature for stale detection and headless validation.
// Включает только стабильные поля, исключает недетерминированные (events, reason, Math.random-зависимые).

import type { WorldState } from "../../../types/world";

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function q(n: number, step: number): number {
  return Math.round(n / step) * step;
}

function q2(n: number): number {
  // useful for 0..1 stats if we decide to include them
  return Math.round(n * 100) / 100;
}

export function worldSignature(world: WorldState): string {
  const agents = [...world.agents].sort((a, b) => a.id.localeCompare(b.id)).map((a) => {
    const intent = a.ai?.currentIntent ?? null;

    // Relationships: сортировка по targetAgentId (единственное стабильное поле)
    const rels = (a.ai?.memory?.relationships ?? [])
      .slice()
      .sort((x, y) => x.targetAgentId.localeCompare(y.targetAgentId))
      .map((r) => ({
        targetAgentId: r.targetAgentId,
        score: q2(r.score), // квантуем score для стабильности
        lastInteractionTick: r.lastInteractionTick,
      }));

    // Traits: сортировка по key
    const traits = (a.ai?.memory?.traits ?? [])
      .slice()
      .sort((x, y) => x.key.localeCompare(y.key))
      .map((t) => ({
        key: t.key,
        level: t.level,
      }));

    return {
      id: a.id,
      roomId: a.roomId,
      state: a.state,

      pos: { x: q(a.position.x, 0.25), y: q(a.position.y, 0.25), z: q(a.position.z, 0.25) },

      nav: {
        isMoving: a.nav?.isMoving ?? false,
        currentIndex: a.nav?.currentIndex ?? 0,
        pathLen: a.nav?.path?.length ?? 0,
        target: a.nav?.targetWorldPos
          ? { x: q(a.nav.targetWorldPos.x, 0.25), y: q(a.nav.targetWorldPos.y, 0.25), z: q(a.nav.targetWorldPos.z, 0.25) }
          : null,
      },

      ai: {
        lastThinkTick: a.ai?.lastThinkTick ?? 0,
        thinkCooldownTicks: a.ai?.thinkCooldownTicks ?? 0,
        intent: intent
          ? {
              action: intent.action,
              targetRoomId: intent.targetRoomId ?? null,
              targetAgentId: intent.targetAgentId ?? null,
              targetPoint: intent.targetPoint
                ? { x: q(intent.targetPoint.x, 0.25), z: q(intent.targetPoint.z, 0.25) }
                : null,
            }
          : null,
      },

      mem: {
        traits,
        rels,
        notesLen: a.ai?.memory?.longTermNotes?.length ?? 0,
        lastDecisionsLen: a.ai?.memory?.lastDecisions?.length ?? 0,
      },

      // revisions are currently "hidden" on Agent via any; include if present
      rev: {
        memoryRevision: (a as any).memoryRevision ?? 0,
        worldRevision: (a as any).worldRevision ?? 0,
        perceptsRevision: (a as any).perceptsRevision ?? 0,
      },
    };
  });

  const rooms = [...world.rooms]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => ({
      id: r.id,
      pos: { x: q(r.position.x, 0.25), y: q(r.position.y, 0.25), z: q(r.position.z, 0.25) },
      size: { x: q(r.size.x, 0.25), y: q(r.size.y, 0.25), z: q(r.size.z, 0.25) },
    }));

  const snapshot = {
    tick: world.tick,
    timeOfDay: world.timeOfDay,
    rooms,
    agents,
    // deliberately exclude events/envObjects for now
  };

  return fnv1a32(JSON.stringify(snapshot));
}

