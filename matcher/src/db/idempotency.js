/**
 * Idempotency for mutating endpoints: store (key -> response) in DB and optionally Redis.
 * If Idempotency-Key is present and we've seen it, return stored response and skip mutation.
 */
import { query } from './client.js';

const IDEM_TTL_SEC = 86400 * 2; // 2 days

/**
 * Try to consume idempotency key: if key exists, return stored response; else return null (proceed with mutation).
 * After mutation, caller should call setIdempotencyResponse(key, response).
 * @param {string} key - Idempotency-Key header value
 * @returns {Promise<object|null>} stored response or null
 */
export async function getIdempotencyResponse(key) {
  if (!key || typeof key !== 'string' || key.length > 128) return null;
  const trimmed = key.trim();
  if (!trimmed) return null;

  const res = await query(
    'SELECT response_body FROM idempotency_keys WHERE idempotency_key = $1', [trimmed]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].response_body;
}

/**
 * Store response for idempotency key (call after successful mutation).
 * @param {string} key
 * @param {object} responseBody - JSON-serializable response to return on duplicate
 */
export async function setIdempotencyResponse(key, responseBody) {
  if (!key || typeof key !== 'string' || key.length > 128) return;
  const trimmed = key.trim();
  if (!trimmed) return;

  await query(
    `INSERT INTO idempotency_keys (idempotency_key, response_body)
     VALUES ($1, $2)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [trimmed, JSON.stringify(responseBody)]
  );

  // Prune old keys (simple: delete older than TTL)
  await query(
    'DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL \'1 second\' * $1',
    [IDEM_TTL_SEC]
  ).catch(() => {});
}
