/**
 * Reconcile matcher state with chain: read Fill and OrderCanceled events,
 * update local order book (remainingSize / remove canceled).
 * Run periodically or after each block.
 */
import { ethers } from 'ethers';
import { OrderBook, getOrderHash } from './orderBook.js';

const EVENT_MARKET_ABI = [
  'event Fill(address indexed taker, address indexed maker, bool takerLong, uint256 price, uint256 size)',
  'event OrderCanceled(address indexed maker, bytes32 orderHash)',
];

async function reconcile(rpcUrl, marketAddresses = [], fromBlock = 0) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const orderBook = new OrderBook();
  // In standalone mode we don't have the in-memory orderBook from the server;
  // this script is intended to be run with state from the API or a shared store.
  // For demo we just log what we would apply.
  const toBlock = await provider.getBlockNumber();
  console.log(`Reconciling blocks ${fromBlock} to ${toBlock} for markets:`, marketAddresses);

  for (const marketAddr of marketAddresses) {
    const contract = new ethers.Contract(marketAddr, EVENT_MARKET_ABI, provider);
    const fillFilter = contract.filters.Fill();
    const cancelFilter = contract.filters.OrderCanceled();
    const [fills, cancels] = await Promise.all([
      contract.queryFilter(fillFilter, fromBlock, toBlock),
      contract.queryFilter(cancelFilter, fromBlock, toBlock),
    ]);
    for (const e of fills) {
      const { taker, maker, takerLong, price, size } = e.args;
      console.log('Fill', { market: marketAddr, taker, maker, takerLong, price: price.toString(), size: size.toString() });
      // To apply: need orderHash from maker order. We don't have it from Fill event.
      // So reconciliation for partial fills requires the indexer to track (maker, nonce, salt) -> orderHash,
      // or the contract would need to emit orderHash in Fill. For now we only support full-order cancel sync.
    }
    for (const e of cancels) {
      const { maker, orderHash } = e.args;
      console.log('OrderCanceled', { market: marketAddr, maker, orderHash });
      // POST /cancel with orderHash would remove from book
    }
  }
  return { fromBlock, toBlock };
}

const rpc = process.env.RPC_URL || process.env.SEPOLIA_RPC_URL || 'http://127.0.0.1:8545';
const markets = process.env.MARKET_ADDRESSES ? process.env.MARKET_ADDRESSES.split(',') : [];
const from = parseInt(process.env.FROM_BLOCK || '0', 10);

reconcile(rpc, markets, from).then((r) => console.log('Done', r)).catch((e) => console.error(e));
