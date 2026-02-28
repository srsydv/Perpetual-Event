# Event Perpetuals V2 — Matcher API

Off-chain order book with price-time priority and chain reconciliation.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /orders | Submit order (maker, market, side, limitPrice, size, nonce, expiry, salt, signature) |
| POST | /cancel | Cancel by orderHash or (market, maker, salt) |
| GET | /book?market=0x... | Order book (bids = long, asks = short) |
| GET | /trades?market=0x... | Recent trades (stub; use indexer for chain data) |
| GET | /positions?market=0x&trader=0x | Positions (stub; read from chain) |
| POST | /simulate-fill | Pre-validate fill (market, taker, takerIsLong, price, size, makerOrder) |
| POST | /apply-fill | Internal: apply fill to local book (market, orderHash, fillSize) |
| POST | /invalidate-nonce | Internal: invalidate V1 orders by (market, maker, nonce) |

## Run

```bash
npm install
PORT=3001 npm start
```

After a successful on-chain fill, call `POST /apply-fill` with the orderHash and fillSize so the book stays in sync. For V1 (single-fill) orders, call `POST /invalidate-nonce` when the fill is confirmed.

## Reconcile script

```bash
RPC_URL=https://... MARKET_ADDRESSES=0x...,0x... FROM_BLOCK=0 node reconcile.js
```

Logs Fill and OrderCanceled events; use with your own state persistence to apply updates.
