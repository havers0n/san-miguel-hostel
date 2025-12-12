// Iter 3: bounded очередь с fair backpressure (drop oldest same-agent else global oldest).

import { EngineRuntime } from "./runtime";
import { DecisionRequest, Tick } from "./types";

export function enqueueWithFairBackpressure(
  runtime: EngineRuntime,
  tick: Tick,
  req: DecisionRequest
): { enqueued: true; dropped?: DecisionRequest } {
  if (runtime.queue.length < runtime.maxQueueSize) {
    runtime.queue.push(req);
    return { enqueued: true };
  }

  // 1) drop oldest of same agent (first match in queue order)
  const idx = runtime.queue.findIndex((q) => q.agentId === req.agentId);
  let dropped: DecisionRequest | undefined;

  if (idx >= 0) dropped = runtime.queue.splice(idx, 1)[0];
  else dropped = runtime.queue.shift();

  runtime.queue.push(req);
  runtime.metrics.backpressureDropsTotal++;

  runtime.pushEngineEvents([
    {
      type: "AI_BACKPRESSURE",
      tick,
      agentId: req.agentId,
      droppedIntentId: dropped?.intentId,
    },
  ]);

  return { enqueued: true, dropped };
}


