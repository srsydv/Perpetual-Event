import { runIndexer } from './src/indexer/chainIndexer.js';

const rpc = process.env.RPC_URL || process.env.SEPOLIA_RPC_URL || 'http://127.0.0.1:8545';
const markets = process.env.MARKET_ADDRESSES ? process.env.MARKET_ADDRESSES.split(',').map((s) => s.trim()).filter(Boolean) : [];
const finality = parseInt(process.env.FINALITY_BLOCKS || '12', 10);

runIndexer(rpc, markets, finality).then((r) => console.log(r)).catch((e) => { console.error(e); process.exit(1); });
