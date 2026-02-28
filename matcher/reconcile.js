/**
 * Reconcile matcher state with chain: run indexer (block-by-block, reorg-safe) then apply chain cancels to matcher book.
 * Usage: RPC_URL=... MARKET_ADDRESSES=0x...,0x... node reconcile.js
 * Optional: FROM_BLOCK=0 FINALITY_BLOCKS=12
 */
import { runIndexer } from './src/indexer/chainIndexer.js';
import { runReconciler } from './src/reconciler/run.js';

async function main() {
  const rpcUrl = process.env.RPC_URL || process.env.SEPOLIA_RPC_URL || 'http://127.0.0.1:8545';
  const marketAddresses = process.env.MARKET_ADDRESSES ? process.env.MARKET_ADDRESSES.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const finalityBlocks = parseInt(process.env.FINALITY_BLOCKS || '12', 10);

  if (marketAddresses.length === 0) {
    console.log('Set MARKET_ADDRESSES=0x...,0x... to reconcile markets.');
    return;
  }

  const indexResult = await runIndexer(rpcUrl, marketAddresses, finalityBlocks);
  console.log('Indexer:', indexResult);

  const reconResult = await runReconciler();
  console.log('Reconciler:', reconResult);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
