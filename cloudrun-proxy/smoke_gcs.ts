import { spawn } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreeLocalPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close(() => reject(new Error("failed to allocate local port")));
        return;
      }
      const port = addr.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function waitForHealthz(baseUrl: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/healthz/`, { method: "GET" });
      const text = await res.text();
      if (res.status === 200 && text === "ok") return;
    } catch {
      // ignore until timeout
    }
    await sleep(100);
  }
  throw new Error(`timeout waiting for GET ${baseUrl}/healthz/`);
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

type DecidePayload = {
  request: {
    requestId: string;
    agentId: string;
    intentId: string;
    contextHash: string;
    createdAtMs: number;
    promptVersion: string;
    ttlMs: number;
  };
  context: {
    agentId: string;
    roomId: string;
    state: string;
    allowlistActions: string[];
  };
};

function makePayload(opts: { requestId: string; promptVersion: string }): DecidePayload {
  // This is a minimal production-shaped payload (no mocks in runtime; only schema-valid smoke input).
  // Important: createdAtMs must be stable across repeats for bit-for-bit output.
  return {
    request: {
      requestId: opts.requestId,
      agentId: "smoke-agent",
      intentId: "smoke-intent",
      contextHash: "smoke-context-hash",
      createdAtMs: 1_700_000_000_000,
      promptVersion: opts.promptVersion,
      ttlMs: 60_000,
    },
    context: {
      agentId: "smoke-agent",
      roomId: "smoke-room",
      state: "ok",
      allowlistActions: ["IDLE", "WANDER"],
    },
  };
}

async function postDecide(baseUrl: string, payload: DecidePayload): Promise<{
  status: number;
  bodyText: string;
  contentType: string | null;
  contentLength: string | null;
}> {
  const res = await fetch(`${baseUrl}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const bodyText = await res.text();
  return {
    status: res.status,
    bodyText,
    contentType: res.headers.get("content-type"),
    contentLength: res.headers.get("content-length"),
  };
}

async function withServer<T>(opts: { port: number; env: Record<string, string | undefined> }, fn: (baseUrl: string, logs: { out: string; err: string }) => Promise<T>): Promise<T> {
  const baseUrl = `http://127.0.0.1:${opts.port}`;
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: { ...process.env, PORT: String(opts.port), ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  let err = "";
  child.stdout?.on("data", (d) => {
    const s = String(d);
    out += s;
    process.stdout.write(s);
  });
  child.stderr?.on("data", (d) => {
    const s = String(d);
    err += s;
    process.stderr.write(s);
  });

  const cleanup = async (): Promise<void> => {
    if (child.killed) return;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once("exit", done);
      child.kill();
      setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 1_000);
      setTimeout(done, 2_000);
    });
  };

  try {
    await waitForHealthz(baseUrl, 8_000);
    return await fn(baseUrl, { out, err });
  } finally {
    await cleanup();
  }
}

async function main(): Promise<void> {
  const bucket = process.env.DECISION_STORE_GCS_BUCKET;
  if (!bucket) {
    throw new Error("DECISION_STORE_GCS_BUCKET is required for smoke:gcs");
  }

  const promptVersion = process.env.SMOKE_PROMPT_VERSION ?? "iter14";
  const requestId = process.env.SMOKE_REQUEST_ID ?? `smoke-${Date.now()}`;

  const payload = makePayload({ requestId, promptVersion });

  // 1) Record mode: first request should record (miss -> create) and return 200.
  // 2) Record mode: second request should be store hit and return 200 with bit-for-bit identical body + headers.
  const port1 = await getFreeLocalPort();
  const recordResult = await withServer(
    { port: port1, env: { PROXY_MODE: "record", DECISION_STORE_GCS_BUCKET: bucket } },
    async (baseUrl) => {
      const r1 = await postDecide(baseUrl, payload);
      const r2 = await postDecide(baseUrl, payload);

      if (r1.status !== 200) throw new Error(`record r1 expected 200, got ${r1.status} ${JSON.stringify(r1.bodyText)}`);
      if (r2.status !== 200) throw new Error(`record r2 expected 200, got ${r2.status} ${JSON.stringify(r2.bodyText)}`);

      const h1 = sha256(r1.bodyText);
      const h2 = sha256(r2.bodyText);
      if (h1 !== h2) throw new Error(`bit-for-bit violated: sha256 r1=${h1} r2=${h2}`);

      if ((r1.contentType ?? "") !== (r2.contentType ?? "")) {
        throw new Error(`Content-Type mismatch: r1=${JSON.stringify(r1.contentType)} r2=${JSON.stringify(r2.contentType)}`);
      }
      if ((r1.contentLength ?? "") !== (r2.contentLength ?? "")) {
        throw new Error(
          `Content-Length mismatch: r1=${JSON.stringify(r1.contentLength)} r2=${JSON.stringify(r2.contentLength)}`
        );
      }

      return { r1, r2, h1 };
    }
  );

  // 3) Replay mode: miss must be loud (404 replay_miss) and visible in logs.
  const port2 = await getFreeLocalPort();
  await withServer(
    { port: port2, env: { PROXY_MODE: "replay", DECISION_STORE_GCS_BUCKET: bucket } },
    async (baseUrl, logs) => {
      const unknownPayload = makePayload({
        requestId: `smoke-replay-miss-${Date.now()}`,
        promptVersion,
      });
      const r = await postDecide(baseUrl, unknownPayload);
      if (r.status !== 404) throw new Error(`replay miss expected 404, got ${r.status} ${JSON.stringify(r.bodyText)}`);
      if (!r.bodyText.includes("replay_miss")) {
        throw new Error(`replay miss body expected to include replay_miss, got ${JSON.stringify(r.bodyText)}`);
      }
      if (!logs.out.includes(`"event":"replay_miss"`)) {
        throw new Error(`replay miss must be logged (event:"replay_miss"), but was not found in stdout`);
      }
    }
  );

  // 4) Write-once гонка: два параллельных запроса с одним requestId должны вернуть одного winner.
  const port3 = await getFreeLocalPort();
  await withServer(
    { port: port3, env: { PROXY_MODE: "record", DECISION_STORE_GCS_BUCKET: bucket } },
    async (baseUrl) => {
      const raceRequestId = `smoke-race-${Date.now()}`;
      const racePayload = makePayload({ requestId: raceRequestId, promptVersion });

      const [a, b] = await Promise.all([postDecide(baseUrl, racePayload), postDecide(baseUrl, racePayload)]);
      if (a.status !== 200) throw new Error(`race a expected 200, got ${a.status} ${JSON.stringify(a.bodyText)}`);
      if (b.status !== 200) throw new Error(`race b expected 200, got ${b.status} ${JSON.stringify(b.bodyText)}`);

      const ha = sha256(a.bodyText);
      const hb = sha256(b.bodyText);
      if (ha !== hb) throw new Error(`write-once race violated: sha256 a=${ha} b=${hb}`);
    }
  );

  console.log(
    JSON.stringify({
      smoke: "ok",
      bucket,
      requestId,
      promptVersion,
      sha256: recordResult.h1,
    })
  );
}

await main();






