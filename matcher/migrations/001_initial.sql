-- Event Perp Matcher: canonical schema for orders, fills, cancels, nonce watermarks, idempotency.
-- Run in order: 001_initial.sql

-- Markets (one row per market address we track)
CREATE TABLE IF NOT EXISTS markets (
  id         SERIAL PRIMARY KEY,
  address    VARCHAR(42) NOT NULL UNIQUE,
  chain_id   BIGINT NOT NULL DEFAULT 11155111,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markets_address ON markets(address);

-- Orders: live limit orders in the book (price-time priority via sort in app)
CREATE TABLE IF NOT EXISTS orders (
  id             BIGSERIAL PRIMARY KEY,
  order_hash     VARCHAR(66) NOT NULL,
  market_id      INT NOT NULL REFERENCES markets(id),
  maker          VARCHAR(42) NOT NULL,
  side           VARCHAR(10) NOT NULL CHECK (side IN ('long', 'short')),
  limit_price    NUMERIC(78,0) NOT NULL,
  size           NUMERIC(78,0) NOT NULL,
  remaining_size NUMERIC(78,0) NOT NULL,
  nonce          BIGINT NOT NULL,
  expiry         BIGINT NOT NULL,
  salt           VARCHAR(66) NOT NULL,
  signature      TEXT,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  UNIQUE(market_id, order_hash)
);

CREATE INDEX IF NOT EXISTS idx_orders_market ON orders(market_id);
CREATE INDEX IF NOT EXISTS idx_orders_maker_market ON orders(market_id, maker);
CREATE INDEX IF NOT EXISTS idx_orders_expiry ON orders(expiry);

-- Order events: audit log for state transitions (submitted, filled, canceled, invalidated)
CREATE TABLE IF NOT EXISTS order_events (
  id         BIGSERIAL PRIMARY KEY,
  order_id   BIGINT NOT NULL REFERENCES orders(id),
  event_type VARCHAR(32) NOT NULL,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);

-- Fills: matcher-side record of applied fills (authoritative state from chain indexer later)
CREATE TABLE IF NOT EXISTS fills (
  id         BIGSERIAL PRIMARY KEY,
  market_id  INT NOT NULL REFERENCES markets(id),
  order_hash VARCHAR(66) NOT NULL,
  taker      VARCHAR(42),
  fill_size  NUMERIC(78,0) NOT NULL,
  price      NUMERIC(78,0),
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fills_market ON fills(market_id);
CREATE INDEX IF NOT EXISTS idx_fills_order ON fills(order_hash);

-- Cancels: record of canceled orders
CREATE TABLE IF NOT EXISTS cancels (
  id         BIGSERIAL PRIMARY KEY,
  market_id  INT NOT NULL REFERENCES markets(id),
  order_hash VARCHAR(66) NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cancels_market ON cancels(market_id);

-- Nonce watermarks: highest nonce seen per (market, maker) for V1 invalidation
CREATE TABLE IF NOT EXISTS nonce_watermarks (
  market_id   INT NOT NULL REFERENCES markets(id),
  maker       VARCHAR(42) NOT NULL,
  nonce       BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  PRIMARY KEY (market_id, maker)
);

-- Idempotency: store response for duplicate mutating requests (key -> response, ttl in app/redis)
CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key VARCHAR(128) PRIMARY KEY,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional: snapshots for mark/book state at a block (for reconciler)
CREATE TABLE IF NOT EXISTS snapshots (
  id         BIGSERIAL PRIMARY KEY,
  market_id  INT NOT NULL REFERENCES markets(id),
  block_num  BIGINT NOT NULL,
  mark_price NUMERIC(78,0),
  book_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_market_block ON snapshots(market_id, block_num);
