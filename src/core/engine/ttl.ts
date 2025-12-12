// Iter 2: TTL-множество для intentId (короткое, дешёвое).
export class TTLSet {
  private map = new Map<string, number>(); // key -> expireAtMs

  constructor(private readonly defaultTtlMs: number) {}

  has(key: string, nowMs: number): boolean {
    const exp = this.map.get(key);
    if (exp == null) return false;
    if (exp <= nowMs) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  add(key: string, nowMs: number, ttlMs?: number): void {
    this.map.set(key, nowMs + (ttlMs ?? this.defaultTtlMs));
  }

  sweep(nowMs: number): void {
    for (const [k, exp] of this.map) {
      if (exp <= nowMs) this.map.delete(k);
    }
  }

  size(): number {
    return this.map.size;
  }
}


