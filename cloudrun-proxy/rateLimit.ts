export type TokenBucket = {
  readonly tryTake: (n?: number) => boolean;
  readonly snapshot: () => { tokens: number; capacity: number };
};

export function createTokenBucket(opts: {
  // steady-state refill rate
  rps: number;
  // maximum burst capacity
  burst: number;
  // time source (ms)
  nowMs?: () => number;
}): TokenBucket {
  const nowMs = opts.nowMs ?? (() => Date.now());

  const capacity = opts.burst;
  const refillPerMs = opts.rps / 1000;

  let tokens = capacity;
  let lastMs = nowMs();

  function refill(): void {
    const t = nowMs();
    const dt = t - lastMs;
    if (dt > 0) {
      tokens = Math.min(capacity, tokens + dt * refillPerMs);
      lastMs = t;
    } else if (dt < 0) {
      // clock skew: do not add tokens, just reset baseline
      lastMs = t;
    }
  }

  return {
    tryTake(n = 1) {
      if (!Number.isFinite(n) || n <= 0) return false;
      refill();
      if (tokens >= n) {
        tokens -= n;
        return true;
      }
      return false;
    },
    snapshot() {
      refill();
      return { tokens, capacity };
    },
  };
}


