-- db/schema.sql
-- SQLite schema for Javaspectre virtual-object excavation catalog.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  session_id      TEXT PRIMARY KEY,
  created_at_iso  TEXT NOT NULL,
  metadata_json   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id     TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  label           TEXT NOT NULL,
  captured_at_iso TEXT NOT NULL,
  metrics_json    TEXT NOT NULL,
  result_json     TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS virtual_object_scores (
  score_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id     TEXT NOT NULL,
  vo_id           TEXT NOT NULL,
  category        TEXT NOT NULL,
  stability       REAL NOT NULL,
  novelty         REAL NOT NULL,
  reuse_hint      TEXT NOT NULL,
  computed_at_iso TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_session_id
  ON snapshots(session_id);

CREATE INDEX IF NOT EXISTS idx_scores_snapshot_id
  ON virtual_object_scores(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_scores_vo_id
  ON virtual_object_scores(vo_id);
