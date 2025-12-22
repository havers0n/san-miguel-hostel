

import { WorldState, Room, Agent, EnvObject, AgentRole, WorldEvent, AgentAIState, AgentDecision, AgentTrait, MemoryUpdate, AgentHighLevelAction, AgentMemory } from '../types/world';
import { NavGrid, findPath, applyAvoidance, findNearestWalkable } from '../utils/NavSystem';
import { Vector3 } from 'three';

// --- Static Data Definitions ---

type RNG = () => number;

function mulberry32(seed: number): RNG {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv1a32u(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

function unit01FromKey(key: string): number {
  return fnv1a32u(key) / 4294967296;
}

function r(rng: RNG, min: number, max: number): number {
  return rng() * (max - min) + min;
}

function rPick<T>(rng: RNG, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

const ROOMS: Room[] = [
  { id: 'r1', name: 'Dorm A', position: { x: -5, y: 1.5, z: -5 }, size: { x: 8, y: 3, z: 8 } },
  { id: 'r2', name: 'Dorm B', position: { x: 5, y: 1.5, z: -5 }, size: { x: 8, y: 3, z: 8 } },
  { id: 'r3', name: 'Common Area', position: { x: 0, y: 1.5, z: 5 }, size: { x: 18, y: 3, z: 10 } },
  { id: 'r4', name: 'Kitchen', position: { x: 12, y: 1.5, z: 5 }, size: { x: 4, y: 3, z: 6 } },
];

const ENV_OBJECTS: EnvObject[] = [
  // Dorm A
  { id: 'bed1', kind: 'BED', roomId: 'r1', position: { x: -7, y: 0.5, z: -7 }, size: { x: 2, y: 1, z: 3 } },
  { id: 'bed2', kind: 'BED', roomId: 'r1', position: { x: -3, y: 0.5, z: -7 }, size: { x: 2, y: 1, z: 3 } },
  // Dorm B
  { id: 'bed3', kind: 'BED', roomId: 'r2', position: { x: 3, y: 0.5, z: -7 }, size: { x: 2, y: 1, z: 3 } },
  { id: 'bed4', kind: 'BED', roomId: 'r2', position: { x: 7, y: 0.5, z: -7 }, size: { x: 2, y: 1, z: 3 } },
  // Common
  { id: 'sofa1', kind: 'SOFA', roomId: 'r3', position: { x: 0, y: 0.5, z: 5 }, size: { x: 4, y: 1, z: 2 } },
  { id: 'table1', kind: 'TABLE', roomId: 'r3', position: { x: 5, y: 1, z: 5 }, size: { x: 3, y: 1.5, z: 3 } },
  // Kitchen
  { id: 'k1', kind: 'KITCHEN', roomId: 'r4', position: { x: 13, y: 1, z: 5 }, size: { x: 1, y: 2, z: 4 } },
  // Doors - increased size for more reliable passage
  { id: 'd1', kind: 'DOOR', roomId: 'r1', position: { x: -5, y: 1.5, z: -1.2 }, size: { x: 2.5, y: 3, z: 0.6 } },
  { id: 'd2', kind: 'DOOR', roomId: 'r2', position: { x: 5, y: 1.5, z: -1.2 }, size: { x: 2.5, y: 3, z: 0.6 } },
  { id: 'd3', kind: 'DOOR', roomId: 'r3', position: { x: 0, y: 1.5, z: 0.2 }, size: { x: 4.5, y: 3, z: 0.6 } },
];

export const navGrid = new NavGrid();
navGrid.initialize(ROOMS, ENV_OBJECTS);

const NAMES = ['Alex', 'Bea', 'Chris', 'Dana', 'Evan', 'Faye', 'Gus'];
const ROLES: AgentRole[] = ['RESIDENT', 'SOCIAL_WORKER', 'GUARD', 'NEWCOMER', 'TRIGGER'];

// --- Helpers ---

function createDefaultMemory(agentId: string, rng: RNG): AgentMemory {
  const baseTraits: AgentTrait[] = [
    { key: 'IMPULSIVE', level: 0 },
    { key: 'ANXIOUS', level: 0 },
    { key: 'CARING', level: 0 },
    { key: 'AGGRESSIVE', level: 0 },
    { key: 'WITHDRAWN', level: 0 },
  ];

  // Deterministic (seeded) trait variation for reproducible headless runs.
  baseTraits.forEach(t => {
    const roll = rng();
    if (roll > 0.85) t.level = 2;
    else if (roll > 0.6) t.level = 1;
  });

  return {
    agentId,
    traits: baseTraits,
    longTermNotes: [],
    relationships: [],
    lastDecisions: [],
  };
}

function createAgent(i: number, rng: RNG): Agent {
  const id = `agent-${i}`;
  const role = ROLES[i % ROLES.length];
  
  // Guard specific tweaks
  const isGuard = role === 'GUARD';
  
  return {
    id,
    name: NAMES[i % NAMES.length],
    role,
    roomId: 'r3',
    position: { x: r(rng, -6, 6), y: 0, z: r(rng, 7, 9) }, // Start in Common Area
    direction: { x: 0, y: 0, z: 1 },
    speed: r(rng, 3.0, 4.5),
    state: 'IDLE',
    nav: {
      path: [],
      currentIndex: 0,
      targetWorldPos: null,
      isMoving: false,
    },
    energy: r(rng, 0.5, 1),
    hunger: r(rng, 0, 0.5),
    anxiety: isGuard ? 0.1 : r(rng, 0, 0.4),
    aggression: isGuard ? 0.1 : r(rng, 0, 0.2),

    ai: {
      memory: createDefaultMemory(id, rng),
      currentIntent: null,
      lastThinkTick: -100, // Ready immediately
      thinkCooldownTicks: 90 + Math.floor(rng() * 60), // ~3-5s
    }
  };
}

// --- Initialization ---

export function createInitialWorldState(opts?: { seed?: number; agentCount?: number; rng?: RNG }): WorldState {
  // Default preserves previous behavior (non-deterministic Math.random) for UI.
  // For headless determinism, pass seed or rng.
  const rng =
    opts?.rng ??
    (opts?.seed != null ? mulberry32((opts.seed ?? 1) >>> 0) : Math.random);
  const agentCount = opts?.agentCount ?? 5;
  return {
    tick: 0,
    timeOfDay: 'DAY',
    rooms: ROOMS,
    envObjects: ENV_OBJECTS,
    agents: Array.from({ length: agentCount }).map((_, i) => createAgent(i, rng)),
    events: [],
    agentsNeedingDecision: [],
    pendingDecisions: [],
  };
}

// --- Logic ---

export function applyMemoryUpdate(
  world: WorldState,
  agentId: string,
  update?: MemoryUpdate
): WorldState {
  if (!update) return world;

  const agents = world.agents.map(a => {
    if (a.id !== agentId) return a;

    const mem = { ...a.ai.memory };

    if (update.longTermNotesToAdd?.length) {
      mem.longTermNotes = [...mem.longTermNotes, ...update.longTermNotesToAdd];
    }

    if (update.relationshipDeltas?.length) {
      const relMap = new Map(mem.relationships.map(r => [r.targetAgentId, r]));
      for (const delta of update.relationshipDeltas) {
        const existing = relMap.get(delta.targetAgentId);
        if (existing) {
          existing.score = Math.max(-100, Math.min(100, existing.score + delta.delta));
          existing.lastInteractionTick = world.tick;
        } else {
          relMap.set(delta.targetAgentId, {
            targetAgentId: delta.targetAgentId,
            score: Math.max(-100, Math.min(100, delta.delta)),
            lastInteractionTick: world.tick,
          });
        }
      }
      mem.relationships = Array.from(relMap.values());
    }

    return {
      ...a,
      ai: { ...a.ai, memory: mem }
    };
  });

  return { ...world, agents };
}

export function applyAgentDecision(world: WorldState, decision: AgentDecision): WorldState {
  let next: WorldState = { ...world, events: [...world.events] };
  const agentIndex = next.agents.findIndex(a => a.id === decision.agentId);
  if (agentIndex === -1) return next;

  const agent = next.agents[agentIndex];
  const now = next.tick;

  const pickInRoom = (room: Room, salt: string) => {
    // Deterministic point selection: depends only on world.tick + agent + room + salt.
    const u1 = unit01FromKey(`${now}:${agent.id}:${room.id}:${salt}:x`);
    const u2 = unit01FromKey(`${now}:${agent.id}:${room.id}:${salt}:z`);
    const dx = (u1 * 2 - 1) * (room.size.x / 3);
    const dz = (u2 * 2 - 1) * (room.size.z / 3);
    return { x: room.position.x + dx, z: room.position.z + dz };
  };

  // Helper to trigger movement
  const triggerMove = (targetX: number, targetZ: number) => {
    next = moveAgentToPoint(next, agent.id, targetX, targetZ);
  };

  // Helper to create event
  const addEvent = (type: string, desc: string, targetId?: string) => {
    const idx = next.events.length;
    next.events.push({
      id: `evt-${now}-${agent.id}-${type}-${idx}`,
      tick: now,
      type: type as any,
      description: desc,
      roomId: agent.roomId,
      agentIds: targetId ? [agent.id, targetId] : [agent.id],
    });
  };

  // Set current intent on agent
  const nextAgents = [...next.agents];
  nextAgents[agentIndex] = {
    ...agent,
    ai: { ...agent.ai, currentIntent: decision }
  };
  next = { ...next, agents: nextAgents };

  switch (decision.action) {
    case 'GO_TO_ROOM': {
      if (decision.targetRoomId) {
        const room = next.rooms.find(r => r.id === decision.targetRoomId);
        if (room) {
          const p = pickInRoom(room, "GO_TO_ROOM");
          const tx = p.x;
          const tz = p.z;
          triggerMove(tx, tz);
          addEvent('MOVEMENT', `${agent.name} is heading to ${room.name}.`);
        }
      }
      break;
    }
    case 'EAT_IN_KITCHEN': {
      const kitchen = next.rooms.find(r => r.name.includes('Kitchen') || r.id === 'r4');
      if (kitchen) {
        const p = pickInRoom(kitchen, "EAT_IN_KITCHEN");
        const tx = p.x;
        const tz = p.z;
        triggerMove(tx, tz);
        addEvent('HELP_REQUEST', `${agent.name} goes to the kitchen to eat. (${decision.reason})`);
      }
      break;
    }
    case 'REST_IN_DORM': {
      // Find nearest dorm or specific one
      const dorm = next.rooms.find(r => r.name.startsWith('Dorm'));
      if (dorm) {
        const p = pickInRoom(dorm, "REST_IN_DORM");
        const tx = p.x;
        const tz = p.z;
        triggerMove(tx, tz);
        addEvent('MOVEMENT', `${agent.name} goes to rest in ${dorm.name}.`);
      }
      break;
    }
    case 'TALK_TO_AGENT': {
      if (decision.targetAgentId) {
        const target = next.agents.find(a => a.id === decision.targetAgentId);
        if (target) {
          triggerMove(target.position.x, target.position.z);
          addEvent('CONVERSATION', `${agent.name} approaches ${target.name} to talk. (${decision.reason})`, target.id);
        }
      }
      break;
    }
    case 'START_CONFLICT': {
      if (decision.targetAgentId) {
        const target = next.agents.find(a => a.id === decision.targetAgentId);
        if (target) {
          triggerMove(target.position.x, target.position.z);
          addEvent('CONFLICT', `${agent.name} starts a conflict with ${target.name}! (${decision.reason})`, target.id);
        }
      }
      break;
    }
    case 'WANDER':
    default:
       const currentRoom = next.rooms.find(rm => rm.id === agent.roomId);
       if (currentRoom) {
          const p = pickInRoom(currentRoom, "WANDER");
          const tx = p.x;
          const tz = p.z;
          triggerMove(tx, tz);
       }
      break;
  }

  return next;
}

function calculateNavPath(start: { x: number, z: number }, end: { x: number, z: number }) {
  const startGrid = navGrid.worldToGrid(start);
  const endGrid = navGrid.worldToGrid(end);
  const path = findPath(startGrid, endGrid, navGrid);
  
  if (path && path.length > 0) {
    return {
      path,
      currentIndex: 0,
      targetWorldPos: navGrid.gridToWorld(path[0]),
      isMoving: true
    };
  }
  return { path: [], currentIndex: 0, targetWorldPos: null, isMoving: false };
}

// Internal helper to update world with new agent movement intent
function moveAgentToPoint(world: WorldState, agentId: string, x: number, z: number): WorldState {
  const agents = world.agents.map(agent => {
    if (agent.id !== agentId) return agent;
    const navState = calculateNavPath(agent.position, { x, z });
    return { 
      ...agent, 
      nav: navState,
      state: 'MOVING' as const,
      // Note: We don't clear currentIntent here automatically because this might BE the execution of the intent
    };
  });
  return { ...world, agents };
}

export function commandMoveAgent(id: string, x: number, z: number, world: WorldState): Agent[] {
   const newState = moveAgentToPoint(world, id, x, z);
   // When commanding manually, we override AI intent
   return newState.agents.map(a => a.id === id ? { ...a, ai: { ...a.ai, currentIntent: null } } : a);
}

export function moveAgentToRoom(id: string, roomId: string, world: WorldState): WorldState {
    const room = world.rooms.find(r => r.id === roomId);
    if (!room) return world;
    const agents = commandMoveAgent(id, room.position.x, room.position.z, world);
    return { ...world, agents };
}

// --- Main Simulation Step ---

export function stepMockWorld(prev: WorldState, delta: number): WorldState {
  // 1. Apply Pending Decisions from AI
  let base: WorldState = { ...prev };

  if (base.pendingDecisions && base.pendingDecisions.length > 0) {
    for (const d of base.pendingDecisions) {
      base = applyAgentDecision(base, d);
    }
    base.pendingDecisions = [];
  }

  const tick = base.tick + 1;
  const agentsNeedingDecision = [...(base.agentsNeedingDecision || [])];

  // 2. Physics & AI Check Loop
  const nextAgents = base.agents.map(agent => {
    let nextAgent = { ...agent };
    let { position, nav, state, roomId } = nextAgent;

    // A. Stats
    const newHunger = Math.min(1, agent.hunger + 0.0001);
    const newEnergy = Math.max(0, agent.energy - 0.00005);
    nextAgent.hunger = newHunger;
    nextAgent.energy = newEnergy;

    // B. Room Update
    const currentRoom = base.rooms.find(r => 
        Math.abs(position.x - r.position.x) < r.size.x/2 && 
        Math.abs(position.z - r.position.z) < r.size.z/2
    );
    if (currentRoom) roomId = currentRoom.id;
    nextAgent.roomId = roomId;

    // C. AI Trigger Check
    const timeSinceThink = tick - nextAgent.ai.lastThinkTick;
    // Think if: Cooldown passed AND (Idle OR Finished Task) AND Not already queued
    const isBusy = nextAgent.nav.isMoving || (nextAgent.ai.currentIntent && nextAgent.ai.currentIntent.action !== 'WANDER');
    
    if (timeSinceThink > nextAgent.ai.thinkCooldownTicks && !isBusy) {
       if (!agentsNeedingDecision.includes(nextAgent.id)) {
          agentsNeedingDecision.push(nextAgent.id);
       }
    }

    // D. Navigation
    if (nav.isMoving && nav.targetWorldPos) {
      const speed = agent.speed * delta;
      
      const target = new Vector3(nav.targetWorldPos.x, 0, nav.targetWorldPos.z);
      const current = new Vector3(position.x, 0, position.z);
      const dist = current.distanceTo(target);

      if (dist < speed) {
        // Reached node
        const nextIdx = nav.currentIndex + 1;
        if (nextIdx < nav.path.length) {
          nav = {
            ...nav,
            currentIndex: nextIdx,
            targetWorldPos: navGrid.gridToWorld(nav.path[nextIdx])
          };
        } else {
          // Finished path
          nav = { ...nav, isMoving: false, targetWorldPos: null };
          state = 'IDLE';
          // Clear intent upon arrival
          nextAgent.ai.currentIntent = null;
        }
      } else {
        // Move towards target
        const dir = new Vector3().subVectors(target, current).normalize();
        
        // Avoidance
        const displacement = applyAvoidance(agent, base.agents, dir.multiplyScalar(speed), delta);
        
        const nextPos = current.clone().add(displacement);
        
        // Check collision before applying
        const gridPos = navGrid.worldToGrid({ x: nextPos.x, z: nextPos.z });
        if (navGrid.isWalkable(gridPos.x, gridPos.z)) {
            position = { x: nextPos.x, y: position.y, z: nextPos.z };
            // Update direction for visual
            if (displacement.lengthSq() > 0.00001) {
                nextAgent.direction = { x: displacement.x, y: 0, z: displacement.z };
            }
        } else {
            // Blocked by wall? Try to slide without avoidance force if possible
            const pathOnlyDisp = dir.multiplyScalar(speed);
            const pathPos = current.clone().add(pathOnlyDisp);
            const pathGrid = navGrid.worldToGrid({ x: pathPos.x, z: pathPos.z });
            
            if (navGrid.isWalkable(pathGrid.x, pathGrid.z)) {
                 position = { x: pathPos.x, y: position.y, z: pathPos.z };
                 nextAgent.direction = { x: pathOnlyDisp.x, y: 0, z: pathOnlyDisp.z };
            }
            // else: stuck
        }
      }
    }

    nextAgent.position = position;
    nextAgent.nav = nav;
    nextAgent.state = state;

    return nextAgent;
  });

  return {
    ...base,
    tick,
    agents: nextAgents,
    events: base.events,
    agentsNeedingDecision,
  };
}