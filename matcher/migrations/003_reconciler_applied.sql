-- Mark chain_cancels as applied after reconciler syncs to matcher book
ALTER TABLE chain_cancels ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chain_cancels_applied ON chain_cancels(applied_at) WHERE applied_at IS NULL;
