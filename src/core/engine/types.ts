// Iter 2: минимальные типы детерминированного движка (engine), без доменных событий.

export type Tick = number;

export type EngineEvent =
  | { type: "SIM_DROPPED_TICKS"; tick: Tick; dropped: number }
  | {
      type: "AI_BACKPRESSURE";
      tick: Tick;
      // Agent that triggered the enqueue attempt.
      enqueuedAgentId: string;
      // Request that got dropped by backpressure (may belong to a different agent).
      droppedAgentId?: string;
      droppedIntentId?: string;
      droppedRequestId?: string;
    }
  | { type: "COMMAND_REJECTED"; tick: Tick; commandId: string; reason: string }
  | { type: "AI_REQUEST_SENT"; tick: Tick; agentId: string; requestId: string }
  | {
      type: "AI_RESULT_RECEIVED";
      tick: Tick;
      agentId: string;
      requestId: string;
      latencyMs: number;
    }
  | {
      type: "AI_REQUEST_FAILED";
      tick: Tick;
      agentId: string;
      requestId: string;
      reason: string;
    }
  | {
      type: "AI_RESULT_DISCARDED";
      tick: Tick;
      agentId: string;
      requestId: string;
      reason: "stale_context" | "duplicate_intent_ttl" | "schema_mismatch" | string;
    };

export type Command = {
  id: string;
  type: string;
  createdAtMs: number;
  actorId?: string;
  payload: unknown;
};

// Iter 13: minimal context for Cloud Run proxy (worker still must not see WorldState).
export type DecideContext = {
  agentId: string;
  roomId: string;
  state: string;
  needs?: {
    energy?: number;
    hunger?: number;
    anxiety?: number;
    aggression?: number;
  };
  nearbyAgents?: Array<{
    id: string;
    role?: string;
    dist?: number;
    state?: string;
  }>;
  rooms?: Array<{ id: string; name?: string }>;
  allowlistActions: string[];
};

export type DecisionRequest = {
  requestId: string;
  agentId: string;
  intentId: string; // agentId:contextHash
  contextHash: string;
  createdAtMs: number;
  promptVersion: string;
  ttlMs: number;
  // Iter 13: serialized minimal context assembled synchronously inside tick/scheduler.
  context: DecideContext;
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


