import express from "express";
import { createTokenBucket } from "./rateLimit.js";
import { ValidationError, validateDecideIn, type DecisionResultOut } from "./validate.js";
import { canonicalStringify } from "./canonicalStringify.js";
import { makeGcsStore, makeKey } from "./gcsStore.js";

const PORT = Number(process.env.PORT ?? "8080");
const BODY_LIMIT = process.env.BODY_LIMIT ?? "64kb";

// Iter 14 defaults: 20 rps, burst 40
const RPS = Number(process.env.RATE_LIMIT_RPS ?? "20");
const BURST = Number(process.env.RATE_LIMIT_BURST ?? "40");

// replay: read-only from GCS, 404 on miss
// record: store result to GCS (canonical JSON), return bit-for-bit bodyText
// live: compute result (Gemini later), may optionally store if BUCKET is configured
const PROXY_MODE = (process.env.PROXY_MODE ?? "record") as "replay" | "record" | "live";
const BUCKET = process.env.DECISION_STORE_GCS_BUCKET;
const PREFIX = process.env.DECISION_STORE_PREFIX ?? "records";
const store = BUCKET ? makeGcsStore({ bucket: BUCKET }) : null;

const IDEMPOTENCY_TTL_MS = 60_000;

type CacheEntry = { bodyText: string; expiresAt: number };
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

/* ===== CORS MUST BE FIRST (before body parsing & routes) ===== */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  // Allow the exact headers the browser asks for (typical: "content-type").
  // This keeps the proxy compatible with stricter client setups without hardcoding a growing list.
  const requestedHeaders = req.headers["access-control-request-headers"];
  res.setHeader(
    "Access-Control-Allow-Headers",
    typeof requestedHeaders === "string" && requestedHeaders.trim().length > 0
      ? requestedHeaders
      : "Content-Type"
  );
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

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

app.post("/decide", async (req, res) => {
  const startMs = Date.now();

  let wasCacheHit = false;
  let wasStoreHit = false;
  let wasFallback = false;
  let wasReplayMiss = false;

  try {
    const validated = validateDecideIn(req.body);
    const { input, fallback } = validated;

    const nowMs = Date.now();

    // Cache is ONLY for live mode idempotency within an instance.
    // In record/replay, the GCS store must remain the source of truth (and visible in logs).
    if (PROXY_MODE === "live") {
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
            action: null,
            latencyMs,
            wasCacheHit,
            wasStoreHit,
            wasFallback,
            wasReplayMiss,
            proxyMode: PROXY_MODE,
          })
        );
        return res.status(200).type("application/json").send(cached.bodyText);
      }
    }

    // GCS replay/record: store is the source of truth for bit-for-bit responses.
    if (PROXY_MODE !== "live") {
      if (!store) {
        return res.status(500).json({
          error: "config_error",
          message: "DECISION_STORE_GCS_BUCKET is required for PROXY_MODE=record|replay",
          latencyMs: Date.now() - startMs,
        });
      }
    }

    const objectKey = store
      ? makeKey({
          prefix: PREFIX,
          promptVersion: input.request.promptVersion,
          requestId: input.request.requestId,
        })
      : null;

    // 1) Store hit (replay / previously recorded)
    if (store && objectKey) {
      const stored = await store.get(objectKey);
      if (stored) {
        wasStoreHit = true;
        if (PROXY_MODE === "live") {
          cache.set(input.request.requestId, {
            bodyText: stored,
            expiresAt: nowMs + IDEMPOTENCY_TTL_MS,
          });
        }
        const latencyMs = Date.now() - startMs;
        console.log(
          JSON.stringify({
            requestId: input.request.requestId,
            agentId: input.request.agentId,
            intentId: input.request.intentId,
            action: null,
            latencyMs,
            wasCacheHit,
            wasStoreHit,
            wasFallback,
            wasReplayMiss,
            proxyMode: PROXY_MODE,
          })
        );
        return res.status(200).type("application/json").send(stored);
      }
    }

    // 2) replay miss is a hard miss
    if (PROXY_MODE === "replay") {
      wasReplayMiss = true;
      console.warn(
        JSON.stringify({
          event: "replay_miss",
          requestId: input.request.requestId,
          agentId: input.request.agentId,
          intentId: input.request.intentId,
          objectKey,
          latencyMs: Date.now() - startMs,
          proxyMode: PROXY_MODE,
        })
      );
      return res.status(404).json({
        error: "replay_miss",
        requestId: input.request.requestId,
        latencyMs: Date.now() - startMs,
      });
    }

    // 3) live mode rate-limit (do not persist to GCS to avoid poisoning replay)
    if (PROXY_MODE === "live" && !bucket.tryTake(1)) {
      wasFallback = true;
      const outObj: DecisionResultOut = {
        ...fallback,
        // Determinism: never overwrite createdAtMs (fallback is already request.createdAtMs).
        decision: { ...fallback.decision, reason: "rate_limited" },
      };
      const bodyText = canonicalStringify(outObj);

      // In-memory cache keeps idempotency within a single instance without poisoning the store.
      cache.set(input.request.requestId, {
        bodyText,
        expiresAt: nowMs + IDEMPOTENCY_TTL_MS,
      });

      const latencyMs = Date.now() - startMs;
      console.log(
        JSON.stringify({
          requestId: input.request.requestId,
          agentId: input.request.agentId,
          intentId: input.request.intentId,
          action: outObj.decision.action,
          latencyMs,
          wasCacheHit,
          wasStoreHit,
          wasFallback,
          wasReplayMiss,
          proxyMode: PROXY_MODE,
        })
      );
      return res.status(200).type("application/json").send(bodyText);
    }

    // Iter 14: no Gemini yet — always fallback, but must still be a valid DecisionResult.
    wasFallback = true;
    const outObj: DecisionResultOut = {
      ...fallback,
      // Determinism: never overwrite createdAtMs (fallback is already request.createdAtMs).
      decision: {
        ...fallback.decision,
        reason: PROXY_MODE === "record" ? "fallback_record" : "fallback_iter14",
      },
    };

    const bodyText = canonicalStringify(outObj);

    // Write-once to store (record mode; live mode writes only if BUCKET is configured)
    // At this point PROXY_MODE is guaranteed to be != "replay" (replay misses already returned 404).
    if (store && objectKey) {
      const put = await store.putIfAbsent(objectKey, bodyText);
      if (put === "exists") {
        // Race winner already stored; return the winner to guarantee bit-for-bit idempotency.
        const winner = await store.get(objectKey);
        if (winner) {
          if (PROXY_MODE === "live") {
            cache.set(input.request.requestId, {
              bodyText: winner,
              expiresAt: nowMs + IDEMPOTENCY_TTL_MS,
            });
          }
          return res.status(200).type("application/json").send(winner);
        }
      }
    }

    if (PROXY_MODE === "live") {
      cache.set(input.request.requestId, {
        bodyText,
        expiresAt: nowMs + IDEMPOTENCY_TTL_MS,
      });
    }

    const latencyMs = Date.now() - startMs;
    console.log(
      JSON.stringify({
        requestId: input.request.requestId,
        agentId: input.request.agentId,
        intentId: input.request.intentId,
        action: outObj.decision.action,
        latencyMs,
        wasCacheHit,
        wasStoreHit,
        wasFallback,
        wasReplayMiss,
        proxyMode: PROXY_MODE,
      })
    );

    return res.status(200).type("application/json").send(bodyText);
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
      proxyMode: PROXY_MODE,
      storeEnabled: Boolean(BUCKET),
    })
  );
});
