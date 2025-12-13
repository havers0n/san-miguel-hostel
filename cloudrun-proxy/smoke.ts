import { spawn } from "node:child_process";
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
      // Canonical endpoint: note the trailing slash (matches Cloud Run frontend behavior).
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

async function main(): Promise<void> {
  const port = await getFreeLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, ["dist/server.js"], {
    env: { ...process.env, PORT: String(port) },
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
      // Windows uses process termination; SIGTERM is fine here.
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
    child.once("exit", (code, signal) => {
      if (code !== null && code !== 0) {
        // Fail fast: server died unexpectedly before checks completed.
        throw new Error(
          `server exited early (code=${code}, signal=${signal ?? "null"})`
        );
      }
    });

    await waitForHealthz(baseUrl, 5_000);

    // Gate 1: health endpoint must be reachable and stable.
    {
      const res = await fetch(`${baseUrl}/healthz/`, { method: "GET" });
      const text = await res.text();
      if (res.status !== 200 || text !== "ok") {
        throw new Error(
          `GET /healthz/ expected 200 'ok', got ${res.status} ${JSON.stringify(text)}`
        );
      }
    }

    // Gate 2: validation behavior on /decide must not regress.
    {
      const res = await fetch(`${baseUrl}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (res.status !== 400) {
        const bodyText = await res.text().catch(() => "");
        throw new Error(
          `POST /decide expected 400, got ${res.status} ${JSON.stringify(bodyText)}`
        );
      }
      const json = (await res.json().catch(() => null)) as null | { error?: unknown };
      if (!json || json.error !== "bad_request") {
        throw new Error(
          `POST /decide expected JSON {error:\"bad_request\"}, got ${JSON.stringify(json)}`
        );
      }
    }

    console.log("smoke ok");
  } catch (e) {
    console.error(
      `smoke failed: ${e instanceof Error ? e.message : String(e)}\n` +
        `--- server stdout ---\n${out}\n` +
        `--- server stderr ---\n${err}\n`
    );
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

await main();


