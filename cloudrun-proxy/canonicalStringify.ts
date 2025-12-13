// Canonical JSON stringify (stable key ordering, no whitespace).
// This is required for bit-for-bit record/replay and idempotency caching.
//
// Notes:
// - Only supports JSON-compatible values (objects, arrays, strings, numbers, booleans, null).
// - Throws on non-finite numbers and unsupported types.

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function canonicalStringify(value: unknown): string {
  if (value === null) return "null";

  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalStringify: non-finite number");
    // JSON.stringify already prints numbers canonically (no trailing .0).
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = value[k];
      // JSON omits undefined in objects. We do the same for canonical output.
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${canonicalStringify(v)}`);
    }
    return `{${parts.join(",")}}`;
  }

  throw new Error(`canonicalStringify: unsupported type ${t}`);
}


