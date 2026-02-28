/**
 * Run one cycle of index price publisher. Use with cron or loop.
 * Env: RPC_URL, FACTORY_ADDRESS, EVENT_ID, MARKET_ADDRESS, MATCHER_BASE_URL, PRIVATE_KEY (optional for dry run), DRY_RUN=true, KILL_SWITCH=false
 */
import { runPublish } from './src/index-publisher/worker.js';

const opts = {
  rpcUrl: process.env.RPC_URL || process.env.SEPOLIA_RPC_URL || 'http://127.0.0.1:8545',
  factoryAddress: process.env.FACTORY_ADDRESS || null,
  eventId: process.env.EVENT_ID != null ? parseInt(process.env.EVENT_ID, 10) : null,
  marketAddress: process.env.MARKET_ADDRESS || null,
  matcherBaseUrl: process.env.MATCHER_BASE_URL || 'http://localhost:3001',
  privateKey: process.env.PRIVATE_KEY || null,
  dryRun: process.env.DRY_RUN !== 'false',
  killSwitch: process.env.KILL_SWITCH === 'true',
};

runPublish(opts).then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(e); process.exit(1); });
