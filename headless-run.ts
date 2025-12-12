// Headless deterministic run (Iter 12.1: manual clock injection, Iter 12.2: world signature).
// This file is intentionally standalone and does not involve React/Three.
// Запуск: npx tsx headless-run.ts

import { createInitialWorldState } from './mock/worldMock';
import { EngineRuntime } from './src/core/engine/runtime';
import { createWorldOps } from './src/core/world/ops';
import { createScheduler } from './src/core/engine/scheduler';
import { createEngineTick } from './src/core/engine/tick';
import { worldSignature } from './src/core/world/signature';
import type { WorldState } from './types/world';

const SIM_DT = 1 / 30; // Фиксированный timestep (30 FPS)

function runHeadless(ticks: number = 10_000): void {
  console.log(`[HEADLESS] Запуск прогона на ${ticks} тиков...`);

  // Инициализация engine (без UI, без worker)
  let nowMs = 0;
  const runtime = new EngineRuntime();
  const worldOps = createWorldOps({ nowMs: () => nowMs });
  const scheduler = createScheduler(worldOps, {
    promptVersion: 'headless-test',
    ttlMs: 20_000,
    cooldownMs: 2_000,
  });
  const engineTick = createEngineTick(runtime, worldOps, scheduler);

  // Начальное состояние мира
  let world: WorldState = createInitialWorldState();
  let engineTickCounter = 0;

  const startTime = Date.now();

  // Прогон тиков
  for (let i = 0; i < ticks; i++) {
    nowMs += SIM_DT * 1000;
    const result = engineTick.tick(world, SIM_DT, engineTickCounter);
    world = result.world;
    engineTickCounter++;

    // Периодический вывод прогресса с подписью мира (Iter 12.2)
    if ((i + 1) % 1000 === 0) {
      const elapsed = Date.now() - startTime;
      const avgMsPerTick = elapsed / (i + 1);
      const sig = worldSignature(world);
      console.log(
        `[HEADLESS] Тик ${i + 1}/${ticks} | ` +
        `Агентов: ${world.agents.length} | ` +
        `Событий: ${world.events.length} | ` +
        `sig=${sig} | ` +
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
  console.log(`  Финальная подпись: ${worldSignature(world)}`);
  console.log(`  Агентов: ${world.agents.length}`);
  console.log(`  Событий в истории: ${world.events.length}`);
  console.log(`  Метрики engine:`);
  console.log(`    - Dropped ticks: ${runtime.metrics.droppedTicksTotal}`);
  console.log(`    - Backpressure drops: ${runtime.metrics.backpressureDropsTotal}`);
  console.log(`    - Discarded decisions: ${runtime.metrics.decisionDiscardedTotal}`);
  console.log(`    - Engine events: ${runtime.eventsRing.length}`);
}

// Запуск
runHeadless(10_000);

