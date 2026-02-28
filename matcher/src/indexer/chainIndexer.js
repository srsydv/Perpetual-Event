/**
 * Block-by-block chain indexer for Fill and OrderCanceled events.
 * Reorg-safe: only process blocks in finality window; on reorg rollback and replay.
 */
import { ethers } from 'ethers';
import { query } from '../db/client.js';

const EVENT_ABI = [
  'event Fill(address indexed taker, address indexed maker, bool takerLong, uint256 price, uint256 size)',
  'event OrderCanceled(address indexed maker, bytes32 orderHash)',
];

const DEFAULT_FINALITY_BLOCKS = 12;

/**
 * Get market_id by address.
 */
async function getMarketId(address) {
  const res = await query('SELECT id FROM markets WHERE address = $1', [address.toLowerCase()]);
  return res.rows[0]?.id ?? null;
}

/**
 * Ensure market exists and return id.
 */
async function ensureMarketId(address) {
  const res = await query(
    'INSERT INTO markets (address, chain_id) VALUES ($1, 11155111) ON CONFLICT (address) DO UPDATE SET address = markets.address RETURNING id',
    [address.toLowerCase()]
  );
  return res.rows[0].id;
}

/**
 * Index one block for a market: Fill and OrderCanceled.
 */
async function indexBlock(contract, marketId, fromBlock, toBlock) {
  const [fills, cancels] = await Promise.all([
    contract.queryFilter(contract.filters.Fill(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.OrderCanceled(), fromBlock, toBlock),
  ]);
  for (const e of fills) {
    const { taker, maker, takerLong, price, size } = e.args;
    await query(
      `INSERT INTO chain_fills (market_id, block_num, tx_hash, log_index, taker, maker, taker_long, price, size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (market_id, block_num, tx_hash, log_index) DO NOTHING`,
      [marketId, e.blockNumber, e.transactionHash, e.index, taker, maker, takerLong, price.toString(), size.toString()]
    );
  }
  for (const e of cancels) {
    const { maker, orderHash } = e.args;
    await query(
      `INSERT INTO chain_cancels (market_id, block_num, tx_hash, maker, order_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (market_id, block_num, tx_hash, order_hash) DO NOTHING`,
      [marketId, e.blockNumber, e.transactionHash, maker, orderHash]
    );
  }
  return { fills: fills.length, cancels: cancels.length };
}

/**
 * Update cursor and optionally store block in reorg buffer.
 */
async function setCursor(marketId, blockNum, blockHash) {
  await query(
    'INSERT INTO indexer_cursor (market_id, block_num, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (market_id) DO UPDATE SET block_num = $2, updated_at = NOW()',
    [marketId, blockNum]
  );
  await query(
    'INSERT INTO indexer_blocks (market_id, block_num, block_hash) VALUES ($1, $2, $3) ON CONFLICT (market_id, block_num) DO UPDATE SET block_hash = $3',
    [marketId, blockNum, blockHash]
  );
}

/**
 * On reorg: remove chain_fills and chain_cancels for blocks > newHead, then reset cursor.
 */
async function rollbackTo(marketId, newHeadBlock) {
  await query('DELETE FROM chain_fills WHERE market_id = $1 AND block_num > $2', [marketId, newHeadBlock]);
  await query('DELETE FROM chain_cancels WHERE market_id = $1 AND block_num > $2', [marketId, newHeadBlock]);
  await query('DELETE FROM indexer_blocks WHERE market_id = $1 AND block_num > $2', [marketId, newHeadBlock]);
  await query('UPDATE indexer_cursor SET block_num = $2, updated_at = NOW() WHERE market_id = $1', [marketId, newHeadBlock]);
}

/**
 * Run indexer for one market from (cursor + 1) to (head - finalityBlocks).
 * If block hash changed for a previously indexed block, rollback and replay.
 */
export async function runIndexer(rpcUrl, marketAddresses, finalityBlocks = DEFAULT_FINALITY_BLOCKS) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const head = await provider.getBlockNumber();
  const safeHead = head - BigInt(finalityBlocks);
  if (safeHead < 0n) return { indexed: 0, reason: 'waiting for finality' };

  let totalFills = 0;
  let totalCancels = 0;
  for (const addr of marketAddresses) {
    const marketId = await ensureMarketId(addr);
    const contract = new ethers.Contract(addr, EVENT_ABI, provider);
    const cursorRes = await query('SELECT block_num FROM indexer_cursor WHERE market_id = $1', [marketId]);
    let fromBlock = cursorRes.rows[0] ? Number(cursorRes.rows[0].block_num) + 1 : 0;
    if (fromBlock > safeHead) continue;

    const toBlock = Number(safeHead);
    for (let b = fromBlock; b <= toBlock; b++) {
      const block = await provider.getBlock(b, false);
      if (!block) continue;
      const existing = await query('SELECT block_hash FROM indexer_blocks WHERE market_id = $1 AND block_num = $2', [marketId, b]);
      if (existing.rows.length > 0 && existing.rows[0].block_hash !== block.hash) {
        await rollbackTo(marketId, b - 1);
        fromBlock = b;
        continue;
      }
      const { fills, cancels } = await indexBlock(contract, marketId, b, b);
      totalFills += fills;
      totalCancels += cancels;
      await setCursor(marketId, b, block.hash);
    }
  }
  return { indexed: totalFills + totalCancels, totalFills, totalCancels };
}
