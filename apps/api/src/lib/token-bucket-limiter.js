// apps/api/src/lib/token-bucket-limiter.js
// In-memory token-bucket rate limiter shared by public endpoints (storefront
// capture, website forms, module public links). Bounded by maxEntries (LRU-ish).

const DEFAULT_MAX_LIMITER_ENTRIES = 10_000;

export function createTokenBucketLimiter({
  capacity,
  refillPerSecond,
  maxEntries = DEFAULT_MAX_LIMITER_ENTRIES,
  now = () => Date.now(),
}) {
  const buckets = new Map();

  function evictOldest() {
    while (buckets.size >= maxEntries) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey === undefined) break;
      buckets.delete(oldestKey);
    }
  }

  function consume(key, cost = 1) {
    const timestamp = now();
    const existing = buckets.get(key);
    const elapsedSeconds = existing
      ? Math.max(0, timestamp - existing.updatedAt) / 1000
      : 0;
    const tokens = existing
      ? Math.min(capacity, existing.tokens + elapsedSeconds * refillPerSecond)
      : capacity;

    if (!existing) evictOldest();
    buckets.delete(key);

    if (tokens < cost) {
      buckets.set(key, { tokens, updatedAt: timestamp });
      return {
        allowed: false,
        retryAfter: Math.max(
          1,
          Math.ceil((cost - tokens) / refillPerSecond),
        ),
      };
    }

    buckets.set(key, {
      tokens: tokens - cost,
      updatedAt: timestamp,
    });
    return { allowed: true, retryAfter: 0 };
  }

  return {
    consume,
    size: () => buckets.size,
  };
}
