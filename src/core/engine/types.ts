// Iter 2: минимальные типы детерминированного движка (engine), без доменных событий.

export type Tick = number;

export type EngineEvent =
  | { type: "SIM_DROPPED_TICKS"; tick: Tick; dropped: number }
  | { type: "AI_BACKPRESSURE"; tick: Tick; agentId: string; droppedIntentId?: string }
  | { type: "COMMAND_REJECTED"; tick: Tick; commandId: string; reason: string }
  | { type: "AI_RESULT_DISCARDED"; tick: Tick; agentId: string; requestId: string; reason: string };

export type Command = {
  id: string;
  type: string;
  createdAtMs: number;
  actorId?: string;
  payload: unknown;
};

export type DecisionRequest = {
  requestId: string;
  agentId: string;
  intentId: string; // agentId:contextHash
  contextHash: string;
  createdAtMs: number;
  promptVersion: string;
  ttlMs: number;
};

export type DecisionResult = {
  requestId: string;
  agentId: string;
  intentId: string;
  contextHash: string;
  createdAtMs: number;
  decisionSchemaVersion: 1;
  decision: unknown;
};

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


