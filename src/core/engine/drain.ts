// Iter 3: атомарные drain'ы (snapshot boundary), без фильтров/валидаций.

import { EngineRuntime } from "./runtime";
import { Command, DecisionResult } from "./types";

export function drainDecisionBuffer(runtime: EngineRuntime): DecisionResult[] {
  const buf = runtime.decisionBuffer;
  if (buf.length === 0) return [];
  runtime.decisionBuffer = []; // atomic swap
  return buf;
}

export function drainCommandBuffer(runtime: EngineRuntime): Command[] {
  const buf = runtime.commandBuffer;
  if (buf.length === 0) return [];
  runtime.commandBuffer = []; // atomic swap
  return buf;
}


