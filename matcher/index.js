/**
 * Matcher API server: orders, book, cancel, simulate-fill.
 * State is in-memory; use reconcile script to sync with chain.
 */
import express from 'express';
import { OrderBook, getOrderHash } from './orderBook.js';

const app = express();
app.use(express.json({ limit: '100kb' }));

export const orderBook = new OrderBook();

const PARAM = (v) => (typeof v === 'string' ? BigInt(v) : BigInt(Number(v)));
const now = () => Math.floor(Date.now() / 1000);

// POST /orders — submit order (store in book)
app.post('/orders', (req, res) => {
  try {
    const {
      maker,
      market,
      side,
      limitPrice,
      size,
      nonce,
      expiry,
      salt,
      signature,
    } = req.body;
    if (!maker || !market || side == null) {
      return res.status(400).json({ error: 'maker, market, side required' });
    }
    const limitPriceB = PARAM(limitPrice ?? 0);
    const sizeB = PARAM(size ?? 0);
    const order = {
      orderId: getOrderHash(market, maker, limitPriceB, sizeB, nonce ?? 0, expiry ?? 0, salt ?? '0x'),
      orderHash: getOrderHash(market, maker, limitPriceB, sizeB, nonce ?? 0, expiry ?? 0, salt ?? '0x'),
      maker,
      market,
      side: side === 'long' || side === true ? 'long' : 'short',
      limitPrice: limitPriceB,
      size: sizeB,
      remainingSize: sizeB,
      nonce: nonce ?? 0,
      expiry: Number(expiry ?? 0) || now() + 86400,
      salt: salt ?? '0x',
      signature: signature ?? '',
      createdAt: now(),
    };
    if (order.expiry <= now()) {
      return res.status(400).json({ error: 'Order expired' });
    }
    const added = orderBook.add(order);
    if (!added) return res.status(409).json({ error: 'Order already exists' });
    res.json({ orderId: order.orderId, order });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// POST /cancel — cancel by orderHash or (market, maker, salt)
app.post('/cancel', (req, res) => {
  try {
    const { orderHash, market, maker, salt } = req.body;
    if (orderHash) {
      for (const [m, orders] of orderBook.ordersByMarket) {
        if (orders.has(orderHash)) {
          orderBook.cancel(m, orderHash);
          return res.json({ canceled: orderHash });
        }
      }
      return res.status(404).json({ error: 'Order not found' });
    }
    if (!market || !maker) return res.status(400).json({ error: 'orderHash or (market, maker, salt) required' });
    const { bids, asks } = orderBook.getBook(market);
    const o = [...bids, ...asks].find((x) => x.maker.toLowerCase() === maker.toLowerCase() && (salt ? x.salt === salt : true));
    if (!o) return res.status(404).json({ error: 'Order not found' });
    const id = o.orderHash || o.orderId;
    orderBook.cancel(market, id);
    res.json({ canceled: id });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// GET /book?market=0x...
app.get('/book', (req, res) => {
  const market = req.query.market;
  if (!market) return res.status(400).json({ error: 'market required' });
  const { bids, asks } = orderBook.getBook(market);
  const fmt = (o) => ({
    orderId: o.orderId,
    orderHash: o.orderHash,
    maker: o.maker,
    side: o.side,
    limitPrice: o.limitPrice.toString(),
    size: o.size.toString(),
    remainingSize: o.remainingSize.toString(),
    nonce: Number(o.nonce),
    expiry: o.expiry,
    createdAt: o.createdAt,
  });
  res.json({ bids: bids.map(fmt), asks: asks.map(fmt) });
});

// GET /trades — stub (real data from chain indexer)
app.get('/trades', (req, res) => {
  const market = req.query.market;
  res.json({ market: market || null, trades: [] });
});

// GET /positions — stub (read from chain in production)
app.get('/positions', (req, res) => {
  const market = req.query.market;
  const trader = req.query.trader;
  res.json({ market: market || null, trader: trader || null, positions: [] });
});

// POST /simulate-fill — validate fill without executing
app.post('/simulate-fill', (req, res) => {
  try {
    const { market, taker, takerIsLong, price, size, makerOrder } = req.body;
    if (!market || !taker || takerIsLong == null || !price || !size || !makerOrder) {
      return res.status(400).json({ error: 'market, taker, takerIsLong, price, size, makerOrder required' });
    }
    const priceB = PARAM(price);
    const sizeB = PARAM(size);
    const [maker, makerPrice, makerSize, makerLongU, nonce, expiry, salt] = makerOrder;
    const makerLong = Number(makerLongU) !== 0;
    if (takerIsLong === makerLong) {
      return res.json({ ok: false, reason: 'Same side: taker must be opposite to maker' });
    }
    if (taker.toLowerCase() === maker.toLowerCase()) {
      return res.json({ ok: false, reason: 'Self-fill not allowed' });
    }
    if (now() > Number(expiry)) {
      return res.json({ ok: false, reason: 'Order expired' });
    }
    const fillSize = sizeB <= makerSize ? sizeB : makerSize;
    if (fillSize <= 0n) return res.json({ ok: false, reason: 'Invalid fill size' });
    if (takerIsLong && makerPrice > priceB) return res.json({ ok: false, reason: 'Price mismatch (taker long)' });
    if (!takerIsLong && makerPrice < priceB) return res.json({ ok: false, reason: 'Price mismatch (taker short)' });
    const orderHash = getOrderHash(market, maker, makerPrice, makerSize, nonce, expiry, salt ?? '0x');
    const orders = orderBook.ordersByMarket.get(market);
    const existing = orders?.get(orderHash);
    const remaining = existing ? existing.remainingSize : makerSize;
    if (fillSize > remaining) {
      return res.json({ ok: false, reason: `Fill size exceeds remaining (${remaining})` });
    }
    res.json({
      ok: true,
      fillSize: fillSize.toString(),
      price: priceB.toString(),
      takerIsLong,
      maker,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// Reconciliation: apply fill to local book (called by indexer or after submit)
app.post('/apply-fill', (req, res) => {
  try {
    const { market, orderHash, fillSize } = req.body;
    if (!market || !orderHash || fillSize == null) {
      return res.status(400).json({ error: 'market, orderHash, fillSize required' });
    }
    orderBook.applyFill(market, orderHash, PARAM(fillSize));
    res.json({ applied: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// Invalidate orders by nonce (V1-style full fill)
app.post('/invalidate-nonce', (req, res) => {
  try {
    const { market, maker, nonce } = req.body;
    if (!market || !maker || nonce == null) return res.status(400).json({ error: 'market, maker, nonce required' });
    orderBook.invalidateByNonce(market, maker, Number(nonce));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`Matcher API on http://localhost:${port}`));
