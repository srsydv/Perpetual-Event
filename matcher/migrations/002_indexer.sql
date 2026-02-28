-- Indexer and reconciliation: chain-backed fills/cancels and block cursor for reorg-safe processing.

-- Chain-indexed fills (from Fill event); used for /trades and reconciler
CREATE TABLE IF NOT EXISTS chain_fills (
  id          BIGSERIAL PRIMARY KEY,
  market_id    INT NOT NULL REFERENCES markets(id),
  block_num    BIGINT NOT NULL,
  tx_hash     VARCHAR(66) NOT NULL,
  log_index   INT NOT NULL,
  taker        VARCHAR(42) NOT NULL,
  maker        VARCHAR(42) NOT NULL,
  taker_long   BOOLEAN NOT NULL,
  price        NUMERIC(78,0) NOT NULL,
  size         NUMERIC(78,0) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(market_id, block_num, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_chain_fills_market ON chain_fills(market_id);
CREATE INDEX IF NOT EXISTS idx_chain_fills_block ON chain_fills(block_num);

-- Chain-indexed cancels (from OrderCanceled event)
CREATE TABLE IF NOT EXISTS chain_cancels (
  id          BIGSERIAL PRIMARY KEY,
  market_id    INT NOT NULL REFERENCES markets(id),
  block_num    BIGINT NOT NULL,
  tx_hash     VARCHAR(66) NOT NULL,
  maker       VARCHAR(42) NOT NULL,
  order_hash  VARCHAR(66) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(market_id, block_num, tx_hash, order_hash)
);

CREATE INDEX IF NOT EXISTS idx_chain_cancels_market ON chain_cancels(market_id);

-- Block cursor per market for reorg-safe indexing (last finalized block we've processed)
CREATE TABLE IF NOT EXISTS indexer_cursor (
  market_id    INT NOT NULL REFERENCES markets(id) PRIMARY KEY,
  block_num    BIGINT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reorg buffer: recent blocks we've indexed; on chain reorg we delete blocks > new head and replay
CREATE TABLE IF NOT EXISTS indexer_blocks (
  id          BIGSERIAL PRIMARY KEY,
  market_id    INT NOT NULL REFERENCES markets(id),
  block_num    BIGINT NOT NULL,
  block_hash  VARCHAR(66) NOT NULL,
  UNIQUE(market_id, block_num)
);

CREATE INDEX IF NOT EXISTS idx_indexer_blocks_market_block ON indexer_blocks(market_id, block_num);
