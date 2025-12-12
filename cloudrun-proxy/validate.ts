export type DecideIn = {
  request: DecisionRequestIn;
  context: DecideContextIn;
};

export type DecisionRequestIn = {
  requestId: string;
  agentId: string;
  intentId: string;
  contextHash: string;
  createdAtMs: number;
  promptVersion: string;
  ttlMs: number;
};

export type DecideContextIn = {
  agentId: string;
  roomId: string;
  state: string;
  needs?: { energy?: number; hunger?: number; anxiety?: number; aggression?: number };
  nearbyAgents?: Array<{ id: string; role?: string; dist?: number; state?: string }>;
  rooms?: Array<{ id: string; name?: string }>;
  allowlistActions: string[];
};

export type AgentDecisionOut = {
  agentId: string;
  tickPlanned: number;
  reason: string;
  action: string;
  targetRoomId?: string;
  targetAgentId?: string;
  targetPoint?: { x: number; z: number };
};

export type DecisionResultOut = {
  requestId: string;
  agentId: string;
  intentId: string;
  contextHash: string;
  createdAtMs: number;
  decisionSchemaVersion: 1;
  decision: AgentDecisionOut;
};

export type Validated = {
  input: DecideIn;
  // A precomputed safe fallback result so handlers never need to craft output.
  fallback: DecisionResultOut;
};

export class ValidationError extends Error {
  readonly status = 400 as const;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function asString(x: unknown, path: string): string {
  if (typeof x !== "string" || x.length === 0) throw new ValidationError(`invalid ${path}`);
  return x;
}

function asFiniteNumber(x: unknown, path: string): number {
  if (typeof x !== "number" || !Number.isFinite(x)) throw new ValidationError(`invalid ${path}`);
  return x;
}

function asStringArray(x: unknown, path: string): string[] {
  if (!Array.isArray(x)) throw new ValidationError(`invalid ${path}`);
  const out: string[] = [];
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (typeof v !== "string" || v.length === 0) throw new ValidationError(`invalid ${path}[${i}]`);
    out.push(v);
  }
  return out;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function validateDecideIn(body: unknown): Validated {
  if (!isObject(body)) throw new ValidationError("invalid body");

  const requestRaw = body.request;
  const contextRaw = body.context;
  if (!isObject(requestRaw)) throw new ValidationError("invalid request");
  if (!isObject(contextRaw)) throw new ValidationError("invalid context");

  const request: DecisionRequestIn = {
    requestId: asString(requestRaw.requestId, "request.requestId"),
    agentId: asString(requestRaw.agentId, "request.agentId"),
    intentId: asString(requestRaw.intentId, "request.intentId"),
    contextHash: asString(requestRaw.contextHash, "request.contextHash"),
    createdAtMs: asFiniteNumber(requestRaw.createdAtMs, "request.createdAtMs"),
    promptVersion: asString(requestRaw.promptVersion, "request.promptVersion"),
    ttlMs: asFiniteNumber(requestRaw.ttlMs, "request.ttlMs"),
  };

  if (request.ttlMs <= 0 || request.ttlMs > 120_000) {
    throw new ValidationError("invalid request.ttlMs");
  }

  const allowlistActions = asStringArray(contextRaw.allowlistActions, "context.allowlistActions");
  if (allowlistActions.length === 0) throw new ValidationError("empty context.allowlistActions");

  const roomsRaw = contextRaw.rooms;
  const rooms = Array.isArray(roomsRaw)
    ? roomsRaw
        .filter(isObject)
        .map((r) => ({
          id: typeof r.id === "string" ? r.id : "",
          name: typeof r.name === "string" ? r.name : undefined,
        }))
        .filter((r) => r.id.length > 0)
        .sort((a, b) => a.id.localeCompare(b.id))
    : undefined;

  const nearbyRaw = contextRaw.nearbyAgents;
  const nearbyAgents = Array.isArray(nearbyRaw)
    ? nearbyRaw
        .filter(isObject)
        .map((a) => ({
          id: typeof a.id === "string" ? a.id : "",
          role: typeof a.role === "string" ? a.role : undefined,
          dist: typeof a.dist === "number" && Number.isFinite(a.dist) ? round2(a.dist) : undefined,
          state: typeof a.state === "string" ? a.state : undefined,
        }))
        .filter((a) => a.id.length > 0)
        .sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0) || a.id.localeCompare(b.id))
        .slice(0, 8)
    : undefined;

  const needsRaw = contextRaw.needs;
  const needs = isObject(needsRaw)
    ? {
        energy:
          typeof needsRaw.energy === "number" && Number.isFinite(needsRaw.energy)
            ? round2(clamp01(needsRaw.energy))
            : undefined,
        hunger:
          typeof needsRaw.hunger === "number" && Number.isFinite(needsRaw.hunger)
            ? round2(clamp01(needsRaw.hunger))
            : undefined,
        anxiety:
          typeof needsRaw.anxiety === "number" && Number.isFinite(needsRaw.anxiety)
            ? round2(clamp01(needsRaw.anxiety))
            : undefined,
        aggression:
          typeof needsRaw.aggression === "number" && Number.isFinite(needsRaw.aggression)
            ? round2(clamp01(needsRaw.aggression))
            : undefined,
      }
    : undefined;

  const context: DecideContextIn = {
    agentId: asString(contextRaw.agentId, "context.agentId"),
    roomId: asString(contextRaw.roomId, "context.roomId"),
    state: asString(contextRaw.state, "context.state"),
    needs,
    nearbyAgents,
    rooms,
    // Important: do not trust request.allowlist; only accept from context.allowlistActions.
    allowlistActions,
  };

  // Cross-check: request.agentId must match context.agentId to prevent confused deputy.
  if (request.agentId !== context.agentId) {
    throw new ValidationError("request.agentId != context.agentId");
  }

  const input: DecideIn = { request, context };

  const fallbackAction =
    allowlistActions.includes("WANDER")
      ? "WANDER"
      : allowlistActions.includes("IDLE")
        ? "IDLE"
        : allowlistActions[0]!;

  const fallback: DecisionResultOut = {
    requestId: request.requestId,
    agentId: request.agentId,
    intentId: request.intentId,
    contextHash: request.contextHash,
    createdAtMs: Date.now(),
    decisionSchemaVersion: 1,
    decision: {
      agentId: request.agentId,
      tickPlanned: 0,
      reason: "fallback",
      action: fallbackAction,
    },
  };

  return { input, fallback };
}


