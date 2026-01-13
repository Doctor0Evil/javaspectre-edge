-- db/migrations/001_add_dom_sheets.sql
-- Optional extension table for DOM sheets persisted in SQLite.

CREATE TABLE IF NOT EXISTS dom_sheets (
  sheet_id            TEXT PRIMARY KEY,
  snapshot_id         TEXT,
  trace_id            TEXT,
  correlation_id      TEXT,
  dom_stability_score REAL NOT NULL,
  dom_tree_json       TEXT NOT NULL,
  noise_stats_json    TEXT NOT NULL,
  created_at_iso      TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dom_sheets_trace_id
  ON dom_sheets(trace_id);

CREATE INDEX IF NOT EXISTS idx_dom_sheets_corr
  ON dom_sheets(correlation_id);
