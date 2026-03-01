# Binary Markets (Polymarket-style)

This product is a **separate** Polymarket-style prediction market: binary YES/NO outcomes, no margin or leverage. Buy/sell shares; at resolution redeem winning shares for 1:1 collateral.

## Contracts (Upgradeable)

- **BinaryMarket** (`src/binary/BinaryMarket.sol`): One market per event, deployed as **BeaconProxy**. Deposit/withdraw collateral; mint/merge shares; trade via CLOB; resolve; redeem. Logic can be upgraded by upgrading the beacon (admin).
- **BinaryMarketFactory** (`src/binary/BinaryMarketFactory.sol`): **UUPS proxy**. Deploys markets via a single **UpgradeableBeacon**; admin can create markets, resolve them, `setMarketBeacon`, and upgrade the factory.

## Deploy

```bash
# From repo root
export COLLATERAL=0x...   # ERC20 collateral (e.g. USDC or MockERC20)
export ADMIN=0x...        # Optional; defaults to deployer
npx hardhat run scripts/deploy-binary.js --network sepolia
```

This deploys: BinaryMarket implementation, UpgradeableBeacon(marketImpl, admin), BinaryMarketFactory implementation, ERC1967Proxy(factoryImpl, initialize(admin, beacon)). It writes `deploy-addresses-binary.json`. For frontend, set env:

- `VITE_BINARY_FACTORY` = factory address
- `VITE_BINARY_MARKET_0` = first market address
- Or paste full JSON into `VITE_BINARY_DEPLOY_JSON` (stringified)

## Frontend

```bash
cd frontend-binary
cp .env.example .env
# Set VITE_BINARY_FACTORY, VITE_BINARY_MARKET_0 (or VITE_BINARY_DEPLOY_JSON), VITE_SEPOLIA_RPC_URL, VITE_MATCHER_API (optional), VITE_WALLETCONNECT_PROJECT_ID
npm install
npm run dev
```

- **Markets**: List and open a market.
- **Market page**: Deposit → Mint shares (optional) → Place limit order (buy/sell YES) → Fill as taker → After resolution, Redeem winning shares.
- **Admin**: Connect as factory admin to resolve a market (YES or NO).

## Matcher

The **same matcher** as the perp product is used. Orders are keyed by market address. For binary markets, sign orders with EIP-712 domain **name** `"BinaryMarket"` and **verifyingContract** = binary market address. The frontend-binary app does this automatically.

## Flow (Polymarket-style)

1. **Deposit** collateral into the market.
2. **Mint shares**: Convert N collateral into N YES + N NO (so you can sell YES or NO on the book).
3. **Trade**: Place limit orders (buy YES / sell YES). Opposite side fills; collateral and YES balances move.
4. **Resolution**: Admin calls `factory.resolveMarket(marketId, outcome)` (true = YES wins).
5. **Redeem**: If YES won, redeem YES shares for 1:1 collateral; if NO won, redeem NO shares.

No margin, no funding, no liquidation — just shares and resolution payout.

## Upgrading

- **Factory**: Deploy new BinaryMarketFactory implementation, then from admin: `factory.upgradeToAndCall(newImpl, "0x")`.
- **Markets**: Deploy new BinaryMarket implementation, then from beacon owner (admin): `beacon.upgradeTo(newMarketImpl)`. All existing market proxies then use the new logic.

Use the script (as admin):

```bash
npx hardhat run scripts/upgrade-binary-sepolia.js --network sepolia
```
