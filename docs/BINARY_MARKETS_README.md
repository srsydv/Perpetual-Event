# Binary Markets (Polymarket-style)

This product is a **separate** Polymarket-style prediction market: binary YES/NO outcomes, no margin or leverage. Buy/sell shares; at resolution redeem winning shares for 1:1 collateral.

## Contracts

- **BinaryMarket** (`src/binary/BinaryMarket.sol`): One market per event. Deposit/withdraw collateral; mint shares (1 collateral → 1 YES + 1 NO); merge (1 YES + 1 NO → 1 collateral); trade via CLOB (same EIP-712 order format as perp); resolve; redeem.
- **BinaryMarketFactory** (`src/binary/BinaryMarketFactory.sol`): Deploys BinaryMarket instances. Admin can create markets and resolve them.

## Deploy

```bash
# From repo root
export COLLATERAL=0x...   # ERC20 collateral (e.g. USDC or MockERC20)
export ADMIN=0x...        # Optional; defaults to deployer
npx hardhat run scripts/deploy-binary.js --network sepolia
```

This writes `deploy-addresses-binary.json`. For frontend, set env:

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
