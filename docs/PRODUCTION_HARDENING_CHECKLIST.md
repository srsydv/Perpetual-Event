# Production Hardening Checklist

Use this checklist before mainnet or production testnet launch.

## Smart contracts

- [ ] All contracts verified on block explorer (implementation + proxy/beacon where applicable).
- [ ] Constructor/initializer uses deployer or nominated admin; no hardcoded keys.
- [ ] Access control: only admin/oracle/factory can call restricted functions; no missing checks.
- [ ] Reentrancy guards on all state-changing external functions that touch collateral.
- [ ] Integer overflow/underflow: Solidity 0.8+ checked math; no unchecked blocks without justification.
- [ ] Oracle/resolution: resolution only by authorized oracle/admin; resolution time enforced (if not in test mode).
- [ ] Pause/close-only: factory pause and market close-only tested; emergency path documented.
- [ ] Upgrade: UUPS/beacon upgrade only by admin; no storage layout conflicts after upgrade.
- [ ] Invariants: total collateral = sum(collateralBalance) + insuranceFund; long OI = short OI.

## Testing

- [ ] Unit tests: create event, deposit/withdraw, submitFill (V1/V2), cancel, liquidate, resolve, settle.
- [ ] Fuzz tests: deposit/withdraw bounds; margin checks.
- [ ] Integration: two-wallet flow (maker signs, taker fills) on testnet.
- [ ] Reorg/replay: nonce and orderHash behaviour under reorg; no double-fill.

## Off-chain (matcher / indexer)

- [ ] Order schema and signature verification match contract (EIP-712, typehash, domain).
- [ ] Matcher enforces opposite side, price bounds, size <= remaining, nonce/expiry.
- [ ] Indexer reconciles with chain (Fill, OrderCanceled); stale orders disabled.
- [ ] simulate-fill and /book APIs return correct data for frontend.

## Frontend / UX

- [ ] Correct chain and contract addresses (env/config); no mainnet keys in frontend.
- [ ] Wallet connection and switch chain (e.g. Sepolia) work; errors shown clearly.
- [ ] Pre-submit validation: stale nonce, expired order, self-fill, price/size mismatch.
- [ ] Admin page: only admin can resolve/set index/close-only; UI reflects chain state.

## Ops and runbooks

- [ ] Runbook: how to pause market, set close-only, resolve event, upgrade implementation.
- [ ] Runbook: how to verify new implementation on explorer after upgrade.
- [ ] Monitoring: failed fills, funding anomalies, liquidation spikes, oracle staleness (if applicable).
- [ ] Keys: admin/oracle keys in secure env; no private keys in repo or frontend.

## Deployment

- [ ] deploy-addresses.*.json and README list proxy/beacon addresses; frontend points at proxy.
- [ ] Verify scripts (e.g. verify-sepolia.js) use correct constructor args and implementation addresses.
- [ ] Staged rollout: deploy to testnet, run E2E, then promote to mainnet with same checklist.

---

*Update this checklist as the protocol evolves.*
