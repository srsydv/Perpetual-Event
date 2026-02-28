# Production Test Matrix

Gates to run before promoting to production or mainnet.

## Unit

| Area | Location | Notes |
|------|----------|--------|
| Contract: deposit, withdraw, fill, cancel, liquidate, resolve | `test/EventPerpetualUpgradeable.t.sol` | Foundry |
| Contract: edge cases (reverts, margins) | `test/event-perpetual.production.js` | Hardhat |
| Matcher: validation, address/size/expiry | `matcher/test/validation.test.js` | `node --test` |
| Matcher: EIP-712 signature verification | `matcher/test/signature.test.js` | `node --test` |

Run: `cd matcher && node --test test/*.test.js`

## Integration

| Area | Prerequisites | Command |
|------|----------------|---------|
| Matcher + DB | PostgreSQL (e.g. `DATABASE_URL`) | Start matcher, run `npm run migrate`, POST /orders, GET /book |
| Two-wallet flow (chain + UI) | Sepolia, two funded wallets | `npx hardhat run scripts/integration-two-wallet.js --network sepolia` |
| Full stack (contract + matcher + frontend) | Local chain or Sepolia, DB | Deploy, run matcher, run reconcile, test UI |

## E2E / Sepolia gates

1. Deploy contracts to Sepolia; verify on Etherscan.
2. Run matcher with `DATABASE_URL`; `GET /health` returns `db: up`.
3. Create event (admin), deposit (two wallets), place order (maker), fill (taker), resolve (admin), settle.
4. Run `reconcile.js` with `MARKET_ADDRESSES`; confirm no errors; GET /trades returns chain fills.

## Chaos (manual or CI)

- **Process restart**: Stop matcher mid-request; restart; repeat same Idempotency-Key request → same response.
- **Duplicate delivery**: Send same POST /orders twice with same Idempotency-Key → 200 and same body.
- **Reorg**: Use a local chain that reorgs; run indexer; confirm rollback and replay (no duplicate chain_fills).

## Load (optional)

- Sustained POST /orders and GET /book; measure p95/p99 latency and error rate.
- Rate limit: 429 after exceeding per-IP or per-maker limit.
