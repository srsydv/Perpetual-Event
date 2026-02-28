# Event Perpetuals V2 — Matcher API

Off-chain order book with price-time priority, PostgreSQL-backed state, optional Redis idempotency cache, and chain reconciliation.

## Prerequisites

- Node 18+
- PostgreSQL (create DB: `createdb event_perp_matcher` or set `PG_DATABASE` / `DATABASE_URL`)
- Optional: Redis (set `REDIS_URL` or `REDIS_HOST` for idempotency cache)

## Setup

```bash
npm install
# Set DB URL or PG_* env vars, then:
npm run migrate
PORT=3001 npm start
```

Env: `DATABASE_URL` or `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`; optional `REDIS_URL`. Optional `MATCHER_CHAIN_ID` (default 11155111) for EIP-712 verification; `MATCHER_INTERNAL_SECRET` or `MATCHER_API_KEY` to protect `/apply-fill` and `/invalidate-nonce`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /orders | Submit order; use header `Idempotency-Key` for duplicate protection |
| POST | /cancel | Cancel by orderHash or (market, maker, salt); idempotent with `Idempotency-Key` |
| GET | /book?market=0x... | Order book (bids = long, asks = short) |
| GET | /trades?market=0x... | Recent trades (stub; use indexer for chain data) |
| GET | /positions?market=0x&trader=0x | Positions (stub; read from chain) |
| POST | /simulate-fill | Pre-validate fill (market, taker, takerIsLong, price, size, makerOrder) |
| POST | /apply-fill | Internal: apply fill to local book; idempotent with `Idempotency-Key` |
| POST | /invalidate-nonce | Internal: invalidate V1 orders by (market, maker, nonce); idempotent |

After a successful on-chain fill, call `POST /apply-fill` with the orderHash and fillSize so the book stays in sync. For V1 (single-fill) orders, call `POST /invalidate-nonce` when the fill is confirmed.

## Reconcile script

```bash
RPC_URL=https://... MARKET_ADDRESSES=0x...,0x... FROM_BLOCK=0 node reconcile.js
```

Logs Fill and OrderCanceled events; use with your own state persistence to apply updates.
