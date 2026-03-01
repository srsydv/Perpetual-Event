# Event Perpetuals – Frontend

Polymarket-style UI for Event Perpetuals on Sepolia. Uses deployed contract addresses from the repo root.

## Setup

```bash
cd frontend
npm install
```

Optional: copy `.env.example` to `.env` and set `VITE_SEPOLIA_RPC_URL` (and WalletConnect project ID if needed).

## Run

```bash
npm run dev
```

Open http://localhost:5173. Connect a wallet on **Sepolia**. Collateral token: `0x799a5570318c0C5Fcfd09b0f573335B5aa8d85Ff`.

## Flow

1. **Markets** – List events (from factory). Click a market to open detail.
2. **Market page** – View probability (mark price), your position, balance. **Deposit**: approve collateral then deposit. **Withdraw**: withdraw from market back to wallet.
3. **Trade** – **Place order**: set price (0–100%), size, Long (YES) or Short (NO), click “Sign order”. Order is stored in the browser. **Fill order**: use a stored order or paste maker order + signature; set your side (taker) and size, then “Submit fill”. Maker and taker must be opposite sides (one long, one short). For single-wallet testing, sign as maker then switch to another account and fill as taker.
4. **Create event** – Admin only. Set name, resolution days, oracle address.

Addresses are in `src/config.ts` (same as `deploy-addresses.sepolia.json`).
