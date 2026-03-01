# Binary Markets Frontend (Polymarket-style)

React + Vite + wagmi frontend for the binary prediction markets (Sepolia). Uses the deployed contracts from `deploy-addresses-binary.json`.

## Quick start (testing)

1. **Contracts are already deployed** – addresses are in `src/data/deploy-addresses-binary.json` and in `.env`. No extra setup needed.

2. **Install and run**
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:5173 (or the URL Vite prints).

3. **Connect wallet** (Sepolia). Get Sepolia ETH from a faucet if needed.

4. **Test flow**
   - **Home**: See “Binary Market #0”, click to open.
   - **Market page**: Approve collateral → Deposit → (optional) Mint shares → Place limit order or fill an order → After resolution, Redeem.
   - **Admin** (nav): Connect as factory admin to resolve a market (YES/NO).

## Config

- **Addresses**: Loaded from `src/data/deploy-addresses-binary.json` by default. Override with `.env`:
  - `VITE_BINARY_FACTORY` – factory proxy address
  - `VITE_BINARY_MARKET_0` – market 0 address
  - `VITE_COLLATERAL` – collateral token address
- **After redeploy**: From repo root run `npx hardhat run scripts/deploy-binary.js --network sepolia`, then in this folder run `npm run sync-deploy` to copy the new addresses into `src/data/`.

## Optional

- **WalletConnect**: Set `VITE_WALLETCONNECT_PROJECT_ID` in `.env` (free at https://cloud.walletconnect.com) to avoid 403 from the modal.
- **Matcher**: Set `VITE_MATCHER_API` (e.g. `http://localhost:3001`) to use the order-book / place-order API.
