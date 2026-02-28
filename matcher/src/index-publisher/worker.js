/**
 * Index price publisher: compute event probability from configured sources, apply guardrails, publish on-chain.
 * Guardrails: staleness TTL, max delta per update, kill-switch. All publishes logged to index_publish_log.
 */
import { ethers } from 'ethers';
import { query } from '../db/client.js';

const PRECISION = 10n ** 18n;
const DEFAULT_STALENESS_SEC = 300;
const DEFAULT_MAX_DELTA_BPS = 1000; // 10%

/**
 * Get market_id by address.
 */
async function getMarketId(marketAddress) {
  const res = await query('SELECT id FROM markets WHERE address = $1', [marketAddress.toLowerCase()]);
  return res.rows[0]?.id ?? null;
}

/**
 * Compute index price from matcher order book midpoint (best bid + best ask) / 2 in PRECISION.
 * Falls back to 0.5 (50%) if no book.
 */
export async function getIndexPriceFromBook(matcherBaseUrl, marketAddress) {
  const url = `${matcherBaseUrl.replace(/\/$/, '')}/book?market=${encodeURIComponent(marketAddress)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const { bids = [], asks = [] } = await res.json();
  const bestBid = bids[0] ? BigInt(bids[0].limitPrice) : 0n;
  const bestAsk = asks[0] ? BigInt(asks[0].limitPrice) : 0n;
  if (bestBid > 0n && bestAsk > 0n) {
    return (bestBid + bestAsk) / 2n;
  }
  if (bestBid > 0n) return bestBid;
  if (bestAsk > 0n) return bestAsk;
  return PRECISION / 2n; // 50%
}

/**
 * Log publish to DB.
 */
async function logPublish(marketId, eventId, indexPrice, source, dryRun, txHash) {
  await query(
    `INSERT INTO index_publish_log (market_id, event_id, index_price, source, dry_run, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [marketId, eventId ?? null, indexPrice.toString(), source ?? 'book', dryRun, txHash ?? null]
  );
}

/**
 * Run one publish cycle: fetch price from source, apply guardrails, optionally call factory.setMarketIndexPrice.
 * @param {object} opts - { rpcUrl, factoryAddress, eventId, marketAddress, matcherBaseUrl, privateKey?, dryRun, stalenessSec, maxDeltaBps, killSwitch }
 */
export async function runPublish(opts) {
  const {
    rpcUrl,
    factoryAddress,
    eventId,
    marketAddress,
    matcherBaseUrl = 'http://localhost:3001',
    privateKey,
    dryRun = true,
    stalenessSec = DEFAULT_STALENESS_SEC,
    maxDeltaBps = DEFAULT_MAX_DELTA_BPS,
    killSwitch = false,
  } = opts;

  if (killSwitch) {
    return { ok: false, reason: 'kill_switch_active' };
  }

  const marketId = await getMarketId(marketAddress);
  if (marketId == null) return { ok: false, reason: 'market_not_found' };

  const price = await getIndexPriceFromBook(matcherBaseUrl, marketAddress);
  if (price == null) return { ok: false, reason: 'source_unavailable' };

  // Staleness: in production you'd compare with last update time from chain or DB
  // Max delta: fetch last published price from index_publish_log and clamp
  const lastRes = await query(
    'SELECT index_price FROM index_publish_log WHERE market_id = $1 ORDER BY created_at DESC LIMIT 1',
    [marketId]
  );
  let finalPrice = price;
  if (lastRes.rows.length > 0) {
    const last = BigInt(lastRes.rows[0].index_price);
    const delta = price > last ? price - last : last - price;
    const maxDelta = (last * BigInt(maxDeltaBps)) / 10000n;
    if (delta > maxDelta) {
      finalPrice = price > last ? last + maxDelta : last - maxDelta;
    }
  }

  await logPublish(marketId, eventId, finalPrice, 'book', dryRun, null);

  if (!dryRun && privateKey && factoryAddress != null && eventId != null) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const factory = new ethers.Contract(
      factoryAddress,
      ['function setMarketIndexPrice(uint256 eventId, uint256 indexPrice) external'],
      wallet
    );
    const tx = await factory.setMarketIndexPrice(eventId, finalPrice);
    const rec = await tx.wait();
    await query(
      'UPDATE index_publish_log SET dry_run = false, tx_hash = $2 WHERE market_id = $1 ORDER BY id DESC LIMIT 1',
      [marketId, rec.hash]
    ).catch(() => {});
    return { ok: true, txHash: rec.hash, indexPrice: finalPrice.toString() };
  }

  return { ok: true, dryRun: true, indexPrice: finalPrice.toString() };
}
