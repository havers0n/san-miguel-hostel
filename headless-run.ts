// Headless deterministic run (Iter 12.1: manual clock injection, Iter 12.2: world signature).
// This file is intentionally standalone and does not involve React/Three.
// Запуск: npx tsx headless-run.ts

import { readFile, writeFile } from "node:fs/promises";
import { createInitialWorldState } from './mock/worldMock';
import { EngineRuntime } from './src/core/engine/runtime';
import { createWorldOps } from './src/core/world/ops';
import { createScheduler } from './src/core/engine/scheduler';
import { createEngineTick } from './src/core/engine/tick';
import { worldSignature } from './src/core/world/signature';
import { DeterministicHeadlessWorker } from "./src/core/engine/headless_worker";
import type { WorldState } from './types/world';

const SIM_DT = 1 / 30; // Фиксированный timestep (30 FPS)
const GOLDEN_PATH = "headless.golden.json";
const CHECKPOINT_EVERY = 1000;

function fnv1a32u(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

type GoldenFile = {
  seed: number;
  ticks: number;
  finalSig: string;
  checkpoints?: Record<string, string>;
};

function parseArgs(argv: string[]): {
  mode: "run" | "golden" | "verify";
  seed: number;
  ticks: number;
} {
  let mode: "run" | "golden" | "verify" = "run";
  let seed = 123;
  let ticks = 10_000;

  for (const a of argv) {
    if (a === "--golden") mode = "golden";
    else if (a === "--verify") mode = "verify";
    else if (a.startsWith("--seed=")) seed = Number(a.slice("--seed=".length));
    else if (a.startsWith("--ticks=")) ticks = Number(a.slice("--ticks=".length));
  }

  if (!Number.isFinite(seed) || seed < 0) throw new Error(`[HEADLESS] invalid --seed=${seed}`);
  if (!Number.isFinite(ticks) || ticks <= 0) throw new Error(`[HEADLESS] invalid --ticks=${ticks}`);
  return { mode, seed, ticks };
}

function validateGoldenFile(x: any): GoldenFile {
  if (!x || typeof x !== "object") throw new Error(`[HEADLESS] ${GOLDEN_PATH}: invalid JSON root`);
  if (!Number.isFinite(x.seed)) throw new Error(`[HEADLESS] ${GOLDEN_PATH}: missing/invalid seed`);
  if (!Number.isFinite(x.ticks)) throw new Error(`[HEADLESS] ${GOLDEN_PATH}: missing/invalid ticks`);
  if (typeof x.finalSig !== "string") throw new Error(`[HEADLESS] ${GOLDEN_PATH}: missing/invalid finalSig`);
  if (x.checkpoints != null && typeof x.checkpoints !== "object") {
    throw new Error(`[HEADLESS] ${GOLDEN_PATH}: invalid checkpoints`);
  }
  return x as GoldenFile;
}

function formatMismatch(label: string, expected: string, actual: string): string {
  return `[HEADLESS] GOLDEN MISMATCH (${label}) expected=${expected} actual=${actual}`;
}

function runHeadless(opts: { ticks: number; seed: number }): {
  seed: number;
  ticks: number;
  finalSig: string;
  checkpoints: Record<string, string>;
} {
  const { ticks, seed } = opts;
  console.log(`[HEADLESS] Запуск прогона на ${ticks} тиков (seed=${seed})...`);

  // Инициализация engine (без UI, без worker)
  let nowMs = 0;
  const runtime = new EngineRuntime();
  // Iter 12.3: намеренно жесткие лимиты, чтобы проверить backpressure + inFlight lifecycle.
  runtime.maxConcurrentRequestsTotal = 4;
  runtime.maxQueueSize = 2;

  const worldOps = createWorldOps({ nowMs: () => nowMs });
  const scheduler = createScheduler(worldOps, {
    promptVersion: 'headless-test',
    ttlMs: 20_000,
    cooldownMs: 0,
    requestIdFactory: ({ seq, agentId, createdAtMs }) =>
      // детерминированный requestId (без crypto/Date.now/Math.random)
      `req-${seq}-${agentId}-${Math.floor(createdAtMs)}`,
  });
  const engineTick = createEngineTick(runtime, worldOps, scheduler);

  // Начальное состояние мира
  let world: WorldState = createInitialWorldState({ seed, agentCount: 6 });
  let engineTickCounter = 0;

  const startTime = Date.now();

  // Iter 12.3: deterministic worker simulation (no timers, no access to world)
  const execute = (req: any) => {
    const base = {
      requestId: req.requestId,
      agentId: req.agentId,
      intentId: req.intentId,
      contextHash: req.contextHash,
      createdAtMs: req.createdAtMs,
      decisionSchemaVersion: 1 as const,
      decision: {
        agentId: req.agentId,
        tickPlanned: 0,
        action: "WANDER",
        reason: "headless",
      },
    };

    const results = [base];

    // deterministic duplicates to test:
    // - duplicate requestId (exactly-once by requestId)
    if ((fnv1a32u(req.requestId) % 17) === 0) {
      results.push({ ...base }); // same requestId again
    }
    // - duplicate intentId (TTL) but new requestId
    if ((fnv1a32u(req.intentId) % 11) === 0) {
      results.push({ ...base, requestId: `${req.requestId}:dup_intent` });
    }
    return results;
  };

  const worker = new DeterministicHeadlessWorker(runtime, execute, { baseLatencyMs: 0 });

  const latencyMsForReq = (req: any) => {
    // deterministic spread: 0 / 1000 / 2000ms
    const bucket = fnv1a32u(req.intentId) % 3;
    return bucket * 1000;
  };

  const assertInvariants = (tickNo: number) => {
    // concurrency bound
    if (runtime.inFlightByAgent.size > runtime.maxConcurrentRequestsTotal) {
      throw new Error(
        `[Iter 12.3] inFlight overflow at t=${tickNo}: ` +
          `${runtime.inFlightByAgent.size} > ${runtime.maxConcurrentRequestsTotal}`
      );
    }
    if (runtime.queue.length > runtime.maxQueueSize) {
      throw new Error(
        `[Iter 12.3] queue overflow at t=${tickNo}: ` +
          `${runtime.queue.length} > ${runtime.maxQueueSize}`
      );
    }

    // inFlight must correspond to either queued or running request (otherwise leak / stuck lock)
    const pending = worker.pendingRequests();
    const union = new Set<string>();
    for (const q of runtime.queue) union.add(q.agentId);
    for (const p of pending) union.add(p.agentId);
    for (const agentId of runtime.inFlightByAgent.keys()) {
      if (!union.has(agentId)) {
        throw new Error(
          `[Iter 12.3] inFlight leak at t=${tickNo}: agent=${agentId} has lock but no queued/pending request`
        );
      }
    }
  };

  const checkpoints: Record<string, string> = {};

  // Прогон тиков
  for (let i = 0; i < ticks; i++) {
    nowMs += SIM_DT * 1000;

    // Worker step happens outside engine tick (runtime buffers), deterministic order.
    worker.step(SIM_DT * 1000, latencyMsForReq);

    const result = engineTick.tick(world, SIM_DT, engineTickCounter);
    world = result.world;
    engineTickCounter++;

    assertInvariants(i + 1);

    // Периодический вывод прогресса с подписью мира (Iter 12.2)
    if ((i + 1) % CHECKPOINT_EVERY === 0) {
      const elapsed = Date.now() - startTime;
      const avgMsPerTick = elapsed / (i + 1);
      const sig = worldSignature(world);
      checkpoints[String(i + 1)] = sig;
      console.log(
        `[HEADLESS] Тик ${i + 1}/${ticks} | ` +
        `Агентов: ${world.agents.length} | ` +
        `Событий: ${world.events.length} | ` +
        `sig=${sig} | ` +
        `queue=${runtime.queue.length} inFlight=${runtime.inFlightByAgent.size} pending=${worker.pendingRequests().length} | ` +
        `dropped=${runtime.metrics.backpressureDropsTotal} discarded=${runtime.metrics.decisionDiscardedTotal} | ` +
        `~${avgMsPerTick.toFixed(3)}ms/тик`
      );
    }
  }

  const totalTime = Date.now() - startTime;
  const avgMsPerTick = totalTime / ticks;

  console.log('\n[HEADLESS] Прогон завершён:');
  console.log(`  Всего тиков: ${ticks}`);
  console.log(`  Время выполнения: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
  console.log(`  Среднее время на тик: ${avgMsPerTick.toFixed(3)}ms`);
  console.log(`  Финальный tick мира: ${world.tick}`);
  const finalSig = worldSignature(world);
  console.log(`  Финальная подпись: ${finalSig}`);
  console.log(`  Агентов: ${world.agents.length}`);
  console.log(`  Событий в истории: ${world.events.length}`);
  console.log(`  Метрики engine:`);
  console.log(`    - Dropped ticks: ${runtime.metrics.droppedTicksTotal}`);
  console.log(`    - Backpressure drops: ${runtime.metrics.backpressureDropsTotal}`);
  console.log(`    - Discarded decisions: ${runtime.metrics.decisionDiscardedTotal}`);
  console.log(`    - Engine events: ${runtime.eventsRing.length}`);

  const discardsByReason = new Map<string, number>();
  let backpressureEvents = 0;
  for (const e of runtime.eventsRing) {
    if (e.type === "AI_BACKPRESSURE") backpressureEvents++;
    if (e.type === "AI_RESULT_DISCARDED") {
      discardsByReason.set(e.reason, (discardsByReason.get(e.reason) ?? 0) + 1);
    }
  }
  console.log(`  Engine events breakdown:`);
  console.log(`    - AI_BACKPRESSURE: ${backpressureEvents}`);
  console.log(
    `    - AI_RESULT_DISCARDED by reason: ${JSON.stringify(Object.fromEntries(discardsByReason.entries()))}`
  );

  return { seed, ticks, finalSig, checkpoints };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === "verify") {
    const raw = await readFile(GOLDEN_PATH, "utf8").catch(() => null);
    if (raw == null) {
      console.error(`[HEADLESS] missing ${GOLDEN_PATH}. Run: npx tsx headless-run.ts --golden`);
      process.exit(1);
    }
    const golden = validateGoldenFile(JSON.parse(raw));

    // verify always runs using golden params (so CI doesn't depend on CLI defaults)
    const res = runHeadless({ ticks: golden.ticks, seed: golden.seed });

    if (res.finalSig !== golden.finalSig) {
      console.error(formatMismatch("finalSig", golden.finalSig, res.finalSig));
      process.exit(1);
    }

    if (golden.checkpoints) {
      for (const [k, expected] of Object.entries(golden.checkpoints)) {
        const actual = res.checkpoints[k];
        if (actual !== expected) {
          console.error(formatMismatch(`checkpoint@${k}`, expected, String(actual)));
          process.exit(1);
        }
      }
    }

    console.log(`[HEADLESS] GOLDEN OK: finalSig=${res.finalSig}`);
    return;
  }

  const res = runHeadless({ ticks: args.ticks, seed: args.seed });

  if (args.mode === "golden") {
    const golden: GoldenFile = {
      seed: res.seed,
      ticks: res.ticks,
      finalSig: res.finalSig,
      checkpoints: res.checkpoints,
    };
    await writeFile(GOLDEN_PATH, JSON.stringify(golden, null, 2) + "\n", "utf8");
    console.log(`[HEADLESS] WROTE GOLDEN: ${GOLDEN_PATH} finalSig=${res.finalSig}`);
  }
}

// Запуск
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

