-- Global daily stats. One row per (day, client) result; aggregated pick counts.
-- Apply with:
--   npx wrangler d1 execute invicto-stats --remote --file=worker/schema.sql

CREATE TABLE IF NOT EXISTS results (
  day TEXT NOT NULL,
  client_id TEXT NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (day, client_id)
);

CREATE INDEX IF NOT EXISTS idx_results_day ON results(day);

CREATE TABLE IF NOT EXISTS picks (
  day TEXT NOT NULL,
  player_id TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, player_id)
);
