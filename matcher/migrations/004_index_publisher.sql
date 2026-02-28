-- Index publisher: log every published index price for observability and incident review
CREATE TABLE IF NOT EXISTS index_publish_log (
  id           BIGSERIAL PRIMARY KEY,
  market_id    INT NOT NULL REFERENCES markets(id),
  event_id     BIGINT,
  index_price  NUMERIC(78,0) NOT NULL,
  source       VARCHAR(64),
  dry_run      BOOLEAN NOT NULL DEFAULT false,
  tx_hash      VARCHAR(66),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_index_publish_log_market ON index_publish_log(market_id);
CREATE INDEX IF NOT EXISTS idx_index_publish_log_created ON index_publish_log(created_at);
