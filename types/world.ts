import { ThreeElements } from '@react-three/fiber';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

export type AgentRole =
  | 'RESIDENT'
  | 'SOCIAL_WORKER'
  | 'GUARD'
  | 'NEWCOMER'
  | 'TRIGGER';

export interface PathNode {
  x: number;
  z: number;
}

export interface AgentNavState {
  path: PathNode[];
  currentIndex: number;
  targetWorldPos: { x: number; y: number; z: number } | null;
  isMoving: boolean;
}

// --- AI & Memory Types ---

export interface AgentTrait {
  key: 'IMPULSIVE' | 'ANXIOUS' | 'CARING' | 'AGGRESSIVE' | 'WITHDRAWN';
  level: 0 | 1 | 2; // 0 = none, 2 = strong
}

export interface Relationship {
  targetAgentId: string;
  score: number;           // -100..100
  lastInteractionTick: number;
}

export type AgentHighLevelAction =
  | 'IDLE'
  | 'GO_TO_ROOM'
  | 'EAT_IN_KITCHEN'
  | 'REST_IN_DORM'
  | 'TALK_TO_AGENT'
  | 'CALM_SOMEONE'
  | 'START_CONFLICT'
  | 'REPORT_TO_GUARD'
  | 'WANDER';

export interface AgentDecision {
  agentId: string;
  tickPlanned: number;
  reason: string;
  action: AgentHighLevelAction;
  targetRoomId?: string;
  targetAgentId?: string;
  targetPoint?: { x: number; z: number };
}

export interface AgentMemory {
  agentId: string;
  traits: AgentTrait[];
  longTermNotes: string[]; // brief text facts
  relationships: Relationship[];
  lastDecisions: AgentDecision[]; // History
}

export interface MemoryUpdate {
  longTermNotesToAdd?: string[];
  relationshipDeltas?: { targetAgentId: string; delta: number }[];
}

export interface AgentAIState {
  memory: AgentMemory;
  currentIntent: AgentDecision | null;
  lastThinkTick: number;
  thinkCooldownTicks: number;
}

// --- Core Types ---

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  // world coordinates (x, y=up, z)
  position: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number }; // normalized look vector
  roomId: string;
  state: 'IDLE' | 'MOVING' | 'TALKING' | 'SLEEPING' | 'AGITATED' | 'CRAVING';
  // Navigation state
  nav: AgentNavState;
  speed: number;
  // 0..1
  energy: number;
  hunger: number;
  anxiety: number;
  aggression: number;
  
  // AI Brain
  ai: AgentAIState;
}

export type EnvObjectKind =
  | 'BED'
  | 'TABLE'
  | 'DOOR'
  | 'WINDOW'
  | 'SOFA'
  | 'KITCHEN'
  | 'BATH'
  | 'LOCKER';

export interface EnvObject {
  id: string;
  kind: EnvObjectKind;
  roomId: string;
  position: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
}

export interface Room {
  id: string;
  name: string;
  // rectangular volume center
  position: { x: number; y: number; z: number }; 
  // dimensions: width (x), height (y), depth (z)
  size: { x: number; y: number; z: number };     
}

export type WorldEventType =
  | 'CONFLICT'
  | 'THEFT'
  | 'HELP_REQUEST'
  | 'RULE_BREAK'
  | 'NIGHT_NOISE'
  | 'RELAPSE'
  | 'CONVERSATION'
  | 'MOVEMENT';

export interface WorldEvent {
  id: string;
  tick: number;
  type: WorldEventType;
  description: string;
  roomId?: string;
  agentIds?: string[];
}

export type TimeOfDay = 'MORNING' | 'DAY' | 'EVENING' | 'NIGHT';

export interface WorldState {
  tick: number;
  timeOfDay: TimeOfDay;
  rooms: Room[];
  envObjects: EnvObject[];
  agents: Agent[];
  events: WorldEvent[]; 
  
  // AI Queues
  agentsNeedingDecision?: string[];
  pendingDecisions?: AgentDecision[];
}