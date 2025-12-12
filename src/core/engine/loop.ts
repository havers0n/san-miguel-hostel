// Iter 4: fixed-step engine loop (accumulator + MAX_ACCUM), без подключения к App.

import { EngineRuntime } from "./runtime";
import { Tick } from "./types";

export type TickFn = (simDt: number) => void;

export class EngineLoop {
  engineTick: Tick = 0;
  accumulator = 0;

  readonly SIM_DT = 1 / 30;
  readonly MAX_TICKS_PER_FRAME = 5;
  readonly MAX_ACCUM = this.SIM_DT * this.MAX_TICKS_PER_FRAME;

  constructor(
    private readonly runtime: EngineRuntime,
    private readonly tickFn: TickFn
  ) {}

  frame(realDtSec: number): void {
    this.accumulator += realDtSec;

    if (this.accumulator > this.MAX_ACCUM) {
      const dropped = Math.floor((this.accumulator - this.MAX_ACCUM) / this.SIM_DT);
      this.accumulator = this.MAX_ACCUM;

      this.runtime.metrics.droppedTicksTotal += dropped;
      this.runtime.pushEngineEvents([
        { type: "SIM_DROPPED_TICKS", tick: this.engineTick, dropped },
      ]);
    }

    let ticksThisFrame = 0;
    while (
      this.accumulator >= this.SIM_DT &&
      ticksThisFrame < this.MAX_TICKS_PER_FRAME
    ) {
      this.tickFn(this.SIM_DT);
      this.accumulator -= this.SIM_DT;
      this.engineTick++;
      ticksThisFrame++;
    }
  }
}


