-- Poll history for observability: track when gmail-intake (and other pollers) run
CREATE TABLE IF NOT EXISTS poll_history (
  id               BIGSERIAL PRIMARY KEY,
  queue_name       TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  duration_ms      INTEGER,
  messages_found   INTEGER DEFAULT 0,
  cases_inserted   INTEGER DEFAULT 0,
  error            TEXT,
  metadata         JSONB
);

CREATE INDEX IF NOT EXISTS idx_poll_history_queue_started ON poll_history(queue_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_poll_history_started ON poll_history(started_at DESC);
