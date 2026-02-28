/**
 * DB-backed order book service. Deterministic price-time priority:
 * bids (long): sort by limitPrice DESC, then createdAt ASC, then orderHash ASC.
 * asks (short): sort by limitPrice ASC, then createdAt ASC, then orderHash ASC.
 */
import * as ordersDb from '../db/orders.js';

/**
 * Stable sort key for orders: [price, createdAt, orderHash].
 * Bids: higher price first, then earlier first, then lower orderHash first.
 * Asks: lower price first, then earlier first, then lower orderHash first.
 */
function sortBids(a, b) {
  const priceCmp = Number(b.limitPrice - a.limitPrice);
  if (priceCmp !== 0) return priceCmp;
  const timeCmp = a.createdAt - b.createdAt;
  if (timeCmp !== 0) return timeCmp;
  return (a.orderHash || a.orderId || '').localeCompare(b.orderHash || b.orderId || '');
}

function sortAsks(a, b) {
  const priceCmp = Number(a.limitPrice - b.limitPrice);
  if (priceCmp !== 0) return priceCmp;
  const timeCmp = a.createdAt - b.createdAt;
  if (timeCmp !== 0) return timeCmp;
  return (a.orderHash || a.orderId || '').localeCompare(b.orderHash || b.orderId || '');
}

/**
 * Get order book for market: bids (long) and asks (short), sorted price-time.
 * @param {string} marketAddress
 * @param {number} nowTs - current unix time
 */
export async function getBook(marketAddress, nowTs) {
  const live = await ordersDb.getLiveOrders(marketAddress, nowTs);
  const bids = live.filter((o) => o.side === 'long').sort(sortBids);
  const asks = live.filter((o) => o.side === 'short').sort(sortAsks);
  return { bids, asks };
}

/**
 * Add order. Idempotent: if (market, orderHash) exists, returns { added: false }.
 * @param {object} order - { orderHash, market, maker, side, limitPrice, size, remainingSize, nonce, expiry, salt, signature, createdAt }
 */
export async function addOrder(order) {
  const result = await ordersDb.insertOrder({
    ...order,
    marketAddress: order.market,
  });
  return result;
}

/**
 * Cancel by orderHash or by (market, maker, salt).
 * @param {{ orderHash?: string, market?: string, maker?: string, salt?: string }}
 * @param {number} nowTs
 */
export async function cancel({ orderHash, market, maker, salt }, nowTs) {
  if (orderHash) {
    const marketAddress = market || await ordersDb.getMarketByOrderHash(orderHash);
    if (!marketAddress) return { canceled: null, error: 'Order not found' };
    const canceled = await ordersDb.cancelOrder(marketAddress, orderHash, nowTs);
    return canceled ? { canceled: orderHash } : { canceled: null, error: 'Order not found' };
  }
  if (!market || !maker) {
    return { canceled: null, error: 'orderHash or (market, maker, salt) required' };
  }
  const candidates = await ordersDb.findOrderByMakerSalt(market, maker, salt);
  if (candidates.length === 0) return { canceled: null, error: 'Order not found' };
  const first = candidates[0];
  const canceled = await ordersDb.cancelOrder(market, first.orderHash, nowTs);
  return { canceled: canceled ? first.orderHash : null, error: canceled ? null : 'Order not found' };
}

/**
 * Apply fill to order (decrease remaining size).
 */
export async function applyFill(market, orderHash, fillSize, nowTs) {
  const ok = await ordersDb.applyFill(market, orderHash, fillSize, nowTs);
  return ok;
}

/**
 * Invalidate orders by nonce (V1-style).
 */
export async function invalidateByNonce(market, maker, nonce, nowTs) {
  const count = await ordersDb.invalidateByNonce(market, maker, nonce, nowTs);
  return count;
}

/**
 * Get single order by market + orderHash (for simulate-fill).
 */
export async function getOrderByHash(market, orderHash) {
  return ordersDb.getOrderByHash(market, orderHash);
}
