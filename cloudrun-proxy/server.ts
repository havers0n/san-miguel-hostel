import express from "express";
import { createTokenBucket } from "./rateLimit.js";
import { ValidationError, validateDecideIn, type DecisionResultOut } from "./validate.js";

const PORT = Number(process.env.PORT ?? "8080");
const BODY_LIMIT = process.env.BODY_LIMIT ?? "64kb";

// Iter 14 defaults: 20 rps, burst 40
const RPS = Number(process.env.RATE_LIMIT_RPS ?? "20");
const BURST = Number(process.env.RATE_LIMIT_BURST ?? "40");

const IDEMPOTENCY_TTL_MS = 60_000;

type CacheEntry = { result: DecisionResultOut; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function sweepCache(nowMs: number): void {
  // Small in-memory TTL sweep (O(n), bounded by traffic); ok for short TTL.
  for (const [k, v] of cache) {
    if (v.expiresAt <= nowMs) cache.delete(k);
  }
}

const bucket = createTokenBucket({ rps: RPS, burst: BURST });

const app = express();
app.disable("x-powered-by");

// Health endpoints MUST be registered before any middleware/routers.
// Cloud Run / load balancers should always get a fast 200 without body parsing.
app.get("/healthz", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});

// Optional: convenient root probe endpoint.
app.get("/", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});

app.use(
  express.json({
    limit: BODY_LIMIT,
    type: ["application/json", "application/*+json"],
  })
);

app.post("/decide", (req, res) => {
  const startMs = Date.now();

  let wasCacheHit = false;
  let wasFallback = false;

  try {
    const validated = validateDecideIn(req.body);
    const { input, fallback } = validated;

    const nowMs = Date.now();
    sweepCache(nowMs);

    const cached = cache.get(input.request.requestId);
    if (cached && cached.expiresAt > nowMs) {
      wasCacheHit = true;
      const latencyMs = Date.now() - startMs;
      console.log(
        JSON.stringify({
          requestId: input.request.requestId,
          agentId: input.request.agentId,
          intentId: input.request.intentId,
          action: (cached.result.decision as any)?.action ?? null,
          latencyMs,
          wasCacheHit,
          wasFallback,
        })
      );
      return res.status(200).json(cached.result);
    }

    if (!bucket.tryTake(1)) {
      wasFallback = true;
      const out: DecisionResultOut = {
        ...fallback,
        createdAtMs: nowMs,
        decision: {
          ...fallback.decision,
          reason: "rate_limited",
        },
      };

      cache.set(input.request.requestId, {
        result: out,
        expiresAt: nowMs + IDEMPOTENCY_TTL_MS,
      });

      const latencyMs = Date.now() - startMs;
      console.log(
        JSON.stringify({
          requestId: input.request.requestId,
          agentId: input.request.agentId,
          intentId: input.request.intentId,
          action: out.decision.action,
          latencyMs,
          wasCacheHit,
          wasFallback,
        })
      );
      return res.status(200).json(out);
    }

    // Iter 14: no Gemini yet — always fallback, but must still be a valid DecisionResult.
    wasFallback = true;
    const out: DecisionResultOut = {
      ...fallback,
      createdAtMs: nowMs,
      decision: {
        ...fallback.decision,
        reason: "fallback_iter14",
      },
    };

    cache.set(input.request.requestId, {
      result: out,
      expiresAt: nowMs + IDEMPOTENCY_TTL_MS,
    });

    const latencyMs = Date.now() - startMs;
    console.log(
      JSON.stringify({
        requestId: input.request.requestId,
        agentId: input.request.agentId,
        intentId: input.request.intentId,
        action: out.decision.action,
        latencyMs,
        wasCacheHit,
        wasFallback,
      })
    );

    return res.status(200).json(out);
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    if (err instanceof ValidationError) {
      return res.status(400).json({
        error: "bad_request",
        message: err.message,
        latencyMs,
      });
    }
    console.error(
      JSON.stringify({
        error: "internal_error",
        message: err instanceof Error ? err.message : String(err),
        latencyMs,
      })
    );
    return res.status(500).json({
      error: "internal_error",
      message: "internal_error",
      latencyMs,
    });
  }
});

app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      msg: "cloudrun-proxy listening",
      port: PORT,
      bodyLimit: BODY_LIMIT,
      rateLimit: { rps: RPS, burst: BURST },
    })
  );
});
