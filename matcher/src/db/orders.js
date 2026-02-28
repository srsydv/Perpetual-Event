/**
 * DB operations for orders: insert, get by market, update remaining_size, delete (cancel), nonce watermarks.
 * All bigint values (limit_price, size, remaining_size, nonce, expiry) stored as strings in JS for pg.
 */
import { query } from './client.js';

/** @typedef {'long'|'short'} Side */

/**
 * Ensure market exists; return market_id.
 * @param {string} address - checksum market address
 * @param {number} [chainId]
 * @returns {Promise<number>}
 */
export async function ensureMarket(address, chainId = 11155111) {
  const res = await query(
    `INSERT INTO markets (address, chain_id) VALUES ($1, $2)
     ON CONFLICT (address) DO UPDATE SET address = markets.address
     RETURNING id`,
    [address.toLowerCase(), chainId]
  );
  return res.rows[0].id;
}

/**
 * Insert order. Returns false if (market_id, order_hash) already exists (idempotent insert).
 * @param {object} o - { orderHash, marketAddress, maker, side, limitPrice, size, remainingSize, nonce, expiry, salt, signature, createdAt }
 * @returns {Promise<{ inserted: boolean, orderId?: number }>}
 */
export async function insertOrder(o) {
  const marketId = await ensureMarket(o.marketAddress);
  const res = await query(
    `INSERT INTO orders (order_hash, market_id, maker, side, limit_price, size, remaining_size, nonce, expiry, salt, signature, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
     ON CONFLICT (market_id, order_hash) DO NOTHING
     RETURNING id`,
    [
      o.orderHash,
      marketId,
      o.maker.toLowerCase(),
      o.side,
      String(o.limitPrice),
      String(o.size),
      String(o.remainingSize),
      Number(o.nonce),
      Number(o.expiry),
      o.salt || '0x',
      o.signature || null,
      Number(o.createdAt),
    ]
  );
  if (res.rows.length === 0) return { inserted: false };
  const orderId = res.rows[0].id;
  await query(
    'INSERT INTO order_events (order_id, event_type, payload) VALUES ($1, $2, $3)',
    [orderId, 'submitted', JSON.stringify({ orderHash: o.orderHash, maker: o.maker })]
  ).catch(() => {});
  return { inserted: true, orderId };
}

/**
 * Get live orders for a market (remaining_size > 0, expiry > now). Sorted in app for price-time.
 * @param {string} marketAddress
 * @param {number} nowTs - current unix timestamp
 */
export async function getLiveOrders(marketAddress, nowTs) {
  const res = await query(
    `SELECT o.id, o.order_hash AS "orderHash", o.maker, o.side, o.limit_price AS "limitPrice",
            o.size, o.remaining_size AS "remainingSize", o.nonce, o.expiry, o.salt, o.created_at AS "createdAt"
     FROM orders o
     JOIN markets m ON m.id = o.market_id
     WHERE m.address = $1 AND o.remaining_size > 0 AND o.expiry > $2`,
    [marketAddress.toLowerCase(), nowTs]
  );
  return res.rows.map(row => ({
    id: row.id,
    orderHash: row.orderHash,
    orderId: row.orderHash,
    maker: row.maker,
    side: row.side,
    limitPrice: BigInt(row.limitPrice),
    size: BigInt(row.size),
    remainingSize: BigInt(row.remainingSize),
    nonce: Number(row.nonce),
    expiry: Number(row.expiry),
    salt: row.salt,
    createdAt: Number(row.createdAt),
  }));
}

/**
 * Apply fill: decrease remaining_size by fillSize. If remaining becomes 0, row stays (reconciler may use it).
 * @param {string} marketAddress
 * @param {string} orderHash
 * @param {bigint} fillSize
 * @param {number} nowTs
 */
export async function applyFill(marketAddress, orderHash, fillSize, nowTs) {
  const fillStr = String(fillSize);
  const res = await query(
    `UPDATE orders o SET remaining_size = o.remaining_size - $3, updated_at = $4
     FROM markets m WHERE o.market_id = m.id AND m.address = $1 AND o.order_hash = $2 AND o.remaining_size >= $3
     RETURNING o.remaining_size`,
    [marketAddress.toLowerCase(), orderHash, fillStr, nowTs]
  );
  if (res.rows.length > 0) {
    const orderIdRes = await query('SELECT id FROM orders WHERE order_hash = $1 LIMIT 1', [orderHash]);
    const oid = orderIdRes.rows[0]?.id;
    if (oid) {
      await query('INSERT INTO order_events (order_id, event_type, payload) VALUES ($1, $2, $3)', [oid, 'fill_applied', JSON.stringify({ fillSize: fillStr })]).catch(() => {});
    }
    await query(
      `INSERT INTO fills (market_id, order_hash, fill_size, created_at) SELECT market_id, $1, $2, $3 FROM orders WHERE order_hash = $1 LIMIT 1`,
      [orderHash, fillStr, nowTs]
    ).catch(() => {});
  }
  return res.rows.length > 0;
}

/**
 * Cancel order: set remaining_size = 0 (or delete). We delete so getLiveOrders naturally excludes it.
 * @param {string} marketAddress
 * @param {string} orderHash
 * @param {number} nowTs
 */
export async function cancelOrder(marketAddress, orderHash, nowTs) {
  const res = await query(
    `UPDATE orders o SET remaining_size = 0, updated_at = $3
     FROM markets m WHERE o.market_id = m.id AND m.address = $1 AND o.order_hash = $2
     RETURNING o.id`,
    [marketAddress.toLowerCase(), orderHash, nowTs]
  );
  if (res.rows.length > 0) {
    const orderIdRes = await query('SELECT id FROM orders WHERE order_hash = $1 LIMIT 1', [orderHash]);
    const oid = orderIdRes.rows[0]?.id;
    if (oid) {
      await query('INSERT INTO order_events (order_id, event_type, payload) VALUES ($1, $2, $3)', [oid, 'canceled', {}]).catch(() => {});
    }
    await query(
      `INSERT INTO cancels (market_id, order_hash, created_at) SELECT market_id, $1, $2 FROM orders WHERE order_hash = $1 LIMIT 1`,
      [orderHash, nowTs]
    ).catch(() => {});
  }
  return res.rows.length > 0;
}

/**
 * Find order by (market, maker, salt) for cancel by maker+salt.
 */
export async function findOrderByMakerSalt(marketAddress, maker, salt) {
  const res = await query(
    `SELECT o.order_hash AS "orderHash" FROM orders o
     JOIN markets m ON m.id = o.market_id
     WHERE m.address = $1 AND o.maker = $2 AND o.remaining_size > 0
     AND ($3::text IS NULL OR o.salt = $3)`,
    [marketAddress.toLowerCase(), maker.toLowerCase(), salt || null]
  );
  return res.rows;
}

/**
 * Invalidate orders by nonce: set remaining_size = 0 for (market, maker) where nonce < given nonce.
 * @param {string} marketAddress
 * @param {string} maker
 * @param {number} nonce
 * @param {number} nowTs
 */
export async function invalidateByNonce(marketAddress, maker, nonce, nowTs) {
  const res = await query(
    `UPDATE orders o SET remaining_size = 0, updated_at = $4
     FROM markets m WHERE o.market_id = m.id AND m.address = $1 AND o.maker = $2 AND o.nonce < $3
     RETURNING o.id, o.order_hash`,
    [marketAddress.toLowerCase(), maker.toLowerCase(), nonce, nowTs]
  );
  for (const row of res.rows) {
    await query(
      'INSERT INTO order_events (order_id, event_type, payload) VALUES ($1, $2, $3)',
      [row.id, 'invalidated', JSON.stringify({ nonce, maker: maker.toLowerCase() })]
    ).catch(() => {});
  }
  return res.rows.length;
}

/**
 * Find market address by order_hash (for cancel by orderHash only).
 * @returns {Promise<string|null>} market address or null
 */
export async function getMarketByOrderHash(orderHash) {
  const res = await query(
    `SELECT m.address FROM orders o JOIN markets m ON m.id = o.market_id WHERE o.order_hash = $1 LIMIT 1`,
    [orderHash]
  );
  return res.rows.length > 0 ? res.rows[0].address : null;
}

/**
 * Get recent trades from chain_fills for a market (indexer-backed).
 */
export async function getChainTrades(marketAddress, limit = 100) {
  const res = await query(
    `SELECT cf.taker, cf.maker, cf.taker_long AS "takerLong", cf.price, cf.size, cf.block_num AS "blockNum", cf.tx_hash AS "txHash"
     FROM chain_fills cf
     JOIN markets m ON m.id = cf.market_id
     WHERE m.address = $1
     ORDER BY cf.block_num DESC, cf.id DESC
     LIMIT $2`,
    [marketAddress.toLowerCase(), limit]
  );
  return res.rows.map((r) => ({
    taker: r.taker,
    maker: r.maker,
    takerLong: r.takerLong,
    price: r.price,
    size: r.size,
    blockNum: r.blockNum,
    txHash: r.txHash,
  }));
}

/**
 * Get single order by market + orderHash (for simulate-fill / apply-fill).
 */
export async function getOrderByHash(marketAddress, orderHash) {
  const res = await query(
    `SELECT o.order_hash AS "orderHash", o.maker, o.side, o.limit_price AS "limitPrice",
            o.size, o.remaining_size AS "remainingSize", o.nonce, o.expiry, o.salt, o.created_at AS "createdAt"
     FROM orders o JOIN markets m ON m.id = o.market_id
     WHERE m.address = $1 AND o.order_hash = $2 AND o.remaining_size > 0`,
    [marketAddress.toLowerCase(), orderHash]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    orderHash: row.orderHash,
    orderId: row.orderHash,
    maker: row.maker,
    side: row.side,
    limitPrice: BigInt(row.limitPrice),
    size: BigInt(row.size),
    remainingSize: BigInt(row.remainingSize),
    nonce: Number(row.nonce),
    expiry: Number(row.expiry),
    salt: row.salt,
    createdAt: Number(row.createdAt),
  };
}
