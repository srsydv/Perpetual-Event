# Testnet (Sepolia) Runbook

## Prerequisites

- `.env` with `SEPOLIA_RPC_URL` and `PRIVATE_KEY` (admin/deployer).
- Collateral token deployed (e.g. `0x799a5570318c0C5Fcfd09b0f573335B5aa8d85Ff` on Sepolia).
- Frontend `config` / `deploy-addresses.sepolia.json` point to the same chain and addresses.

## Deploy (fresh)

```bash
npx hardhat run scripts/deploy-upgradeable.js --network sepolia
```

This writes `deploy-addresses.sepolia.json`. Use **EventFactory proxy** and **Market Beacon** in the app; per-event markets are created by the factory and are BeaconProxy instances.

## Upgrade (same proxy/beacon)

```bash
npx hardhat run scripts/upgrade-sepolia.js --network sepolia
```

- Deployer must be the **admin** (factory admin and beacon owner).
- Script updates `deploy-addresses.sepolia.json` with new implementation addresses.
- After upgrade, verify the **new** implementation contracts (see below).

## Verify on Etherscan

```bash
npx hardhat run scripts/verify-sepolia.js --network sepolia
```

Verify:

- **EventFactoryUpgradeable** implementation (no constructor args).
- **EventMarketUpgradeable** implementation (no constructor args).
- **UpgradeableBeacon** with constructor args `(eventMarketImplementation, admin)`.
- **ERC1967Proxy** for the factory with constructor args `(eventFactoryImplementation, initializeCalldata)`.

Use `eventFactoryImplementation` and `eventMarketImplementation` from `deploy-addresses.sepolia.json` (current after upgrade).

## Integration test (two-wallet flow)

Uses two signers (e.g. first two Hardhat accounts). Ensure they have collateral and gas on Sepolia.

```bash
npx hardhat run scripts/integration-two-wallet.js --network sepolia
```

Steps performed: create event (if none), approve + deposit (maker and taker), sign order (maker), submit fill (taker), assert positions and mark price.

## Staged test campaign

1. **Deploy or upgrade** (see above).
2. **Verify** all implementations and proxy/beacon.
3. **Update frontend** config from `deploy-addresses.sepolia.json`.
4. **Run integration script** once to confirm full flow.
5. **Manual UI**: connect two wallets, deposit, place limit order (maker), fill as taker (opposite side), resolve (admin), settle and withdraw.
6. **Check**: positions, balances, mark price, and resolution match expectations.

## Monitoring (recommended)

- **Failed fills**: track `submitFill` reverts (e.g. via indexer or logs).
- **Funding**: log `FundingUpdated` and compare `fundingIndex` to expected formula.
- **Liquidations**: log `Liquidate` and ensure penalty/reward/insurance fund math.
- **Oracle / index**: if using an external index feed, alert on staleness or invalid index.
- **RPC**: monitor Sepolia RPC latency and errors for deploy and frontend.

## Emergency

- **Pause market**: `factory.pauseEvent(eventId)` (admin). Frontend should respect `paused` and disable trading.
- **Close-only**: `factory.setMarketCloseOnly(eventId, true)` (admin). New opens disabled; only reduce/withdraw.
- **Resolution**: `factory.resolveEvent(eventId, outcome)` (admin or oracle). Then traders call `market.settleAndWithdraw()`.

## Rollback (upgrade)

To roll back to a previous implementation: deploy the **old** implementation again (or use a known address), then run the upgrade script with that address, or call `beacon.upgradeTo(oldImpl)` and `factory.upgradeToAndCall(oldFactoryImpl, "0x")` as admin. Ensure storage layout is compatible.
