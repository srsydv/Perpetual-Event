/**
 * In-memory order book: price-time priority, deterministic tie-break by orderId.
 * Orders keyed by market; each side (long/short) sorted by price then createdAt.
 * orderHash matches contract getOrderHash(market, maker, price, size, nonce, expiry, salt).
 */

import { keccak256, AbiCoder } from 'ethers';

const abiCoder = AbiCoder.defaultAbiCoder();

export function getOrderHash(market, maker, limitPrice, size, nonce, expiry, salt) {
  const saltHex = typeof salt === 'string' && salt.startsWith('0x') ? salt : `0x${String(salt).padStart(64, '0')}`;
  return keccak256(
    abiCoder.encode(
      ['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32'],
      [market, maker, limitPrice, size, nonce, expiry, saltHex]
    )
  );
}

export class OrderBook {
  constructor() {
    /** @type {Map<string, Map<string, Order>>} market -> orderId -> order */
    this.ordersByMarket = new Map();
    /** @type {Map<string, { bids: Order[], asks: Order[] }>} market -> sorted bids (long = buy YES), asks (short = sell YES) */
    this.bookByMarket = new Map();
  }

  /**
   * @param {string} market
   * @returns {{ bids: Order[], asks: Order[] }}
   */
  getBook(market) {
    if (!this.bookByMarket.has(market)) {
      this.bookByMarket.set(market, { bids: [], asks: [] });
      this.ordersByMarket.set(market, new Map());
    }
    const { bids, asks } = this.bookByMarket.get(market);
    const orders = this.ordersByMarket.get(market);
    const live = (arr) => arr.filter((o) => {
      const id = o.orderHash || o.orderId;
      return orders.get(id)?.remainingSize > 0n && o.expiry > Math.floor(Date.now() / 1000);
    });
    return { bids: live(bids), asks: live(asks) };
  }

  /**
   * @param {Order} order
   */
  add(order) {
    const market = order.market;
    if (!this.ordersByMarket.has(market)) {
      this.ordersByMarket.set(market, new Map());
      this.bookByMarket.set(market, { bids: [], asks: [] });
    }
    const orders = this.ordersByMarket.get(market);
    const { bids, asks } = this.bookByMarket.get(market);
    const id = order.orderHash || order.orderId;
    if (orders.has(id)) return false;
    orders.set(id, order);
    const arr = order.side === 'long' ? bids : asks;
    arr.push(order);
    // price-time: best bid = highest price first; best ask = lowest price first
    const idA = (a) => a.orderHash || a.orderId;
    if (order.side === 'long') {
      arr.sort((a, b) => Number(b.limitPrice - a.limitPrice) || a.createdAt - b.createdAt || (idA(a) < idA(b) ? -1 : 1));
    } else {
      arr.sort((a, b) => Number(a.limitPrice - b.limitPrice) || a.createdAt - b.createdAt || (idA(a) < idA(b) ? -1 : 1));
    }
    return true;
  }

  /**
   * @param {string} market
   * @param {string} id
   * @param {bigint} fillSize
   */
  applyFill(market, id, fillSize) {
    const orders = this.ordersByMarket.get(market);
    if (!orders) return;
    const o = orders.get(id);
    if (!o) return;
    o.remainingSize = o.remainingSize - fillSize;
    if (o.remainingSize <= 0n) orders.delete(id);
  }

  /**
   * @param {string} market
   * @param {string} id
   */
  cancel(market, id) {
    const orders = this.ordersByMarket.get(market);
    if (!orders) return false;
    return orders.delete(id);
  }

  /**
   * @param {string} market
   * @param {string} maker
   * @param {bigint} nonce
   */
  invalidateByNonce(market, maker, nonce) {
    const orders = this.ordersByMarket.get(market);
    if (!orders) return;
    for (const [id, o] of orders.entries()) {
      if (o.maker.toLowerCase() === maker.toLowerCase() && o.nonce < nonce) orders.delete(id);
    }
  }
}

/**
 * @typedef {{
 *   orderId: string;
 *   orderHash?: string;
 *   maker: string;
 *   market: string;
 *   side: 'long' | 'short';
 *   limitPrice: bigint;
 *   size: bigint;
 *   remainingSize: bigint;
 *   nonce: number | bigint;
 *   expiry: number;
 *   salt: string;
 *   signature?: string;
 *   createdAt: number;
 * }} Order
 */
