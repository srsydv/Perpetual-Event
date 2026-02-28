/**
 * Matcher API server: orders, book, cancel, simulate-fill.
 * State is DB-backed (PostgreSQL); optional Redis for idempotency cache.
 * Security: EIP-712 signature verification, validation, internal auth, rate limits, audit logs.
 */
import express from 'express';
import { getOrderHash } from './orderBook.js';
import * as orderBookService from './src/services/orderBookService.js';
import * as idempotencyDb from './src/db/idempotency.js';
import { getIdempotencyRedis, setIdempotencyRedis } from './src/redis.js';
import { verifyOrderSignature } from './src/auth/verifyOrderSignature.js';
import { validateOrderBody } from './src/validation.js';
import { internalAuth } from './src/middleware/internalAuth.js';
import { rateLimitByIp, rateLimitByMaker } from './src/middleware/rateLimit.js';

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(rateLimitByIp);

const CHAIN_ID = Number(process.env.MATCHER_CHAIN_ID || process.env.CHAIN_ID || 11155111);

const PARAM = (v) => (typeof v === 'string' ? BigInt(v) : BigInt(Number(v)));
const now = () => Math.floor(Date.now() / 1000);

async function getIdempotency(key) {
  const fromRedis = await getIdempotencyRedis(key);
  if (fromRedis != null) return fromRedis;
  return idempotencyDb.getIdempotencyResponse(key);
}
async function setIdempotency(key, body) {
  await setIdempotencyRedis(key, body);
  await idempotencyDb.setIdempotencyResponse(key, body);
}

// POST /orders — submit order (store in book); idempotent when Idempotency-Key header is set
app.post('/orders', rateLimitByMaker, async (req, res) => {
  const idemKey = req.headers['idempotency-key'];
  if (idemKey) {
    const cached = await getIdempotency(idemKey);
    if (cached != null) return res.status(cached.status || 200).json(cached.body);
  }
  try {
    const ts = now();
    const validated = validateOrderBody(req.body, ts);
    if (!validated.ok) return res.status(400).json({ error: validated.error });
    const v = validated.value;
    const orderHash = getOrderHash(v.market, v.maker, v.limitPrice, v.size, v.nonce, v.expiry, v.salt);
    if (v.signature && !verifyOrderSignature({
      marketAddress: v.market,
      chainId: CHAIN_ID,
      maker: v.maker,
      price: v.limitPrice,
      size: v.size,
      isLong: v.side === 'long',
      nonce: v.nonce,
      expiry: v.expiry,
      salt: v.salt,
      signature: v.signature,
    })) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    const order = {
      orderHash,
      orderId: orderHash,
      maker: v.maker,
      market: v.market,
      side: v.side,
      limitPrice: v.limitPrice,
      size: v.size,
      remainingSize: v.size,
      nonce: v.nonce,
      expiry: v.expiry,
      salt: v.salt,
      signature: v.signature,
      createdAt: ts,
    };
    const { inserted } = await orderBookService.addOrder(order);
    if (!inserted) {
      const err = { error: 'Order already exists' };
      if (idemKey) await setIdempotency(idemKey, { status: 409, body: err });
      return res.status(409).json(err);
    }
    const body = { orderId: order.orderId, order };
    if (idemKey) await setIdempotency(idemKey, { status: 200, body });
    res.json(body);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// POST /cancel — cancel by orderHash or (market, maker, salt); idempotent with Idempotency-Key
app.post('/cancel', async (req, res) => {
  const idemKey = req.headers['idempotency-key'];
  if (idemKey) {
    const cached = await getIdempotency(idemKey);
    if (cached != null) return res.status(cached.status || 200).json(cached.body);
  }
  try {
    const { orderHash, market, maker, salt } = req.body;
    const ts = now();
    const { canceled, error: errMsg } = await orderBookService.cancel({ orderHash, market, maker, salt }, ts);
    if (errMsg) {
      const status = errMsg === 'orderHash or (market, maker, salt) required' ? 400 : 404;
      const body = { error: errMsg };
      if (idemKey) await setIdempotency(idemKey, { status, body });
      return res.status(status).json(body);
    }
    const body = { canceled };
    if (idemKey) await setIdempotency(idemKey, { status: 200, body });
    res.json(body);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// GET /book?market=0x...
app.get('/book', async (req, res) => {
  const market = req.query.market;
  if (!market) return res.status(400).json({ error: 'market required' });
  try {
    const { bids, asks } = await orderBookService.getBook(market, now());
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
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// GET /trades — indexer-backed (chain_fills)
app.get('/trades', async (req, res) => {
  const market = req.query.market;
  const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
  if (!market) return res.status(400).json({ error: 'market required' });
  try {
    const { getChainTrades } = await import('./src/db/orders.js');
    const trades = await getChainTrades(market, limit);
    // Serialize bigint-like strings from pg
    const out = trades.map((t) => ({ ...t, price: String(t.price), size: String(t.size) }));
    res.json({ market, trades: out });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// GET /positions — stub (read from chain in production)
app.get('/positions', (req, res) => {
  const market = req.query.market;
  const trader = req.query.trader;
  res.json({ market: market || null, trader: trader || null, positions: [] });
});

// POST /simulate-fill — validate fill without executing
app.post('/simulate-fill', async (req, res) => {
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
    const existing = await orderBookService.getOrderByHash(market, orderHash);
    const remaining = existing ? existing.remainingSize : BigInt(makerSize);
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

// Reconciliation: apply fill to local book (called by indexer or after submit); idempotent with Idempotency-Key; internal auth
app.post('/apply-fill', internalAuth, async (req, res) => {
  const idemKey = req.headers['idempotency-key'];
  if (idemKey) {
    const cached = await getIdempotency(idemKey);
    if (cached != null) return res.status(cached.status || 200).json(cached.body);
  }
  try {
    const { market, orderHash, fillSize } = req.body;
    if (!market || !orderHash || fillSize == null) {
      return res.status(400).json({ error: 'market, orderHash, fillSize required' });
    }
    const applied = await orderBookService.applyFill(market, orderHash, PARAM(fillSize), now());
    const body = { applied };
    if (idemKey) await setIdempotency(idemKey, { status: 200, body });
    res.json(body);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// Invalidate orders by nonce (V1-style full fill); idempotent with Idempotency-Key; internal auth
app.post('/invalidate-nonce', internalAuth, async (req, res) => {
  const idemKey = req.headers['idempotency-key'];
  if (idemKey) {
    const cached = await getIdempotency(idemKey);
    if (cached != null) return res.status(cached.status || 200).json(cached.body);
  }
  try {
    const { market, maker, nonce } = req.body;
    if (!market || !maker || nonce == null) return res.status(400).json({ error: 'market, maker, nonce required' });
    await orderBookService.invalidateByNonce(market, maker, Number(nonce), now());
    const body = { ok: true };
    if (idemKey) await setIdempotency(idemKey, { status: 200, body });
    res.json(body);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// GET /health — liveness and readiness (DB, optional Redis)
app.get('/health', async (req, res) => {
  const status = { ok: true, db: 'unknown', redis: 'optional' };
  try {
    const { query } = await import('./src/db/client.js');
    await query('SELECT 1');
    status.db = 'up';
  } catch (e) {
    status.ok = false;
    status.db = 'down';
    status.dbError = e.message;
  }
  try {
    const { getRedis } = await import('./src/redis.js');
    const redis = await getRedis();
    status.redis = redis ? 'up' : 'skipped';
  } catch {
    status.redis = 'skipped';
  }
  res.status(status.ok ? 200 : 503).json(status);
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`Matcher API on http://localhost:${port}`));
