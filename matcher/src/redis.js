/**
 * Optional Redis client for cache and idempotency. If REDIS_URL is not set, all functions no-op / return null.
 */
let client = null;

function getRedisUrl() {
  return process.env.REDIS_URL || process.env.REDIS_HOST ? (
    process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`
  ) : null;
}

export async function getRedis() {
  if (client) return client;
  const url = getRedisUrl();
  if (!url) return null;
  try {
    const mod = await import('ioredis');
    client = new mod.default(url, { maxRetriesPerRequest: 2, lazyConnect: true });
    await client.connect();
    return client;
  } catch (e) {
    console.warn('Redis not available:', e.message);
    return null;
  }
}

const IDEM_PREFIX = 'idem:';
const IDEM_TTL = 86400 * 2; // 2 days

/**
 * Get idempotency response from Redis (fast path). Falls back to DB in idempotency.js if not in Redis.
 */
export async function getIdempotencyRedis(key) {
  const redis = await getRedis();
  if (!redis || !key) return null;
  try {
    const raw = await redis.get(IDEM_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setIdempotencyRedis(key, responseBody) {
  const redis = await getRedis();
  if (!redis || !key) return;
  try {
    await redis.setex(IDEM_PREFIX + key, IDEM_TTL, JSON.stringify(responseBody));
  } catch (_) {}
}

export async function closeRedis() {
  if (client) {
    await client.quit();
    client = null;
  }
}
