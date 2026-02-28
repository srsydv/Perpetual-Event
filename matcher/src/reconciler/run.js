/**
 * Authoritative reconciler: run indexer then apply chain state to matcher ledger.
 * - Applies chain_cancels to matcher (cancel by orderHash).
 * - Chain fills are indexed for /trades; applying to book requires orderHash (client calls /apply-fill after submitFill).
 */
import { query } from '../db/client.js';
import * as orderBookService from '../services/orderBookService.js';

const now = () => Math.floor(Date.now() / 1000);

/**
 * Apply chain_cancels that haven't been applied yet: cancel each order in matcher book, then mark applied_at.
 */
async function applyChainCancels() {
  const res = await query(`
    SELECT cc.id, cc.market_id, cc.order_hash, m.address AS market_address
    FROM chain_cancels cc
    JOIN markets m ON m.id = cc.market_id
    WHERE cc.applied_at IS NULL
    ORDER BY cc.block_num, cc.id
  `);
  const ts = now();
  let applied = 0;
  for (const row of res.rows) {
    const { id, market_address, order_hash } = row;
    const ok = await orderBookService.cancel({ orderHash: order_hash, market: market_address }, ts);
    if (ok.canceled != null) {
      await query('UPDATE chain_cancels SET applied_at = NOW() WHERE id = $1', [id]);
      applied++;
    }
  }
  return applied;
}

/**
 * Run indexer then reconciler. Call after runIndexer().
 */
export async function runReconciler() {
  const applied = await applyChainCancels();
  return { cancelsApplied: applied };
}
