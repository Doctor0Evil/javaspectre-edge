import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import logger from "./Logger.js";

export class Persistence {
  constructor(options = {}) {
    const dbPath =
      options.databasePath ||
      path.join(process.cwd(), "javaspectre-catalog.sqlite3");

    const exists = fs.existsSync(dbPath);
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    if (!exists || options.ensureSchema === true) {
      this._ensureSchema(options.schemaPath);
    }
    this._prepareStatements();
    logger.info("persistence-initialized", { dbPath });
  }

  _ensureSchema(schemaPath) {
    const effectivePath =
      schemaPath || path.join(process.cwd(), "db", "schema.sql");
    const sql = fs.readFileSync(effectivePath, "utf8");
    this.db.exec(sql);
    logger.info("schema-applied", { schemaPath: effectivePath });
  }

  _prepareStatements() {
    this.insertSessionStmt = this.db.prepare(`
      INSERT OR IGNORE INTO sessions (session_id, created_at_iso, metadata_json)
      VALUES (@session_id, @created_at_iso, @metadata_json)
    `);

    this.updateSessionMetadataStmt = this.db.prepare(`
      UPDATE sessions
         SET metadata_json = @metadata_json
       WHERE session_id = @session_id
    `);

    this.insertSnapshotStmt = this.db.prepare(`
      INSERT INTO snapshots (snapshot_id, session_id, label, captured_at_iso, metrics_json, result_json)
      VALUES (@snapshot_id, @session_id, @label, @captured_at_iso, @metrics_json, @result_json)
    `);

    this.insertScoreStmt = this.db.prepare(`
      INSERT INTO virtual_object_scores (snapshot_id, vo_id, category, stability, novelty, reuse_hint, computed_at_iso)
      VALUES (@snapshot_id, @vo_id, @category, @stability, @novelty, @reuse_hint, @computed_at_iso)
    `);

    this.loadSessionSnapshotsStmt = this.db.prepare(`
      SELECT snapshot_id, label, captured_at_iso, metrics_json, result_json
        FROM snapshots
       WHERE session_id = ?
       ORDER BY captured_at_iso ASC
    `);
  }

  saveSession(session) {
    const payload = {
      session_id: session.id,
      created_at_iso: session.createdAt,
      metadata_json: JSON.stringify(session.metadata || {})
    };
    this.insertSessionStmt.run(payload);
    this.updateSessionMetadataStmt.run(payload);
  }

  saveSnapshot(sessionId, snapshot) {
    const payload = {
      snapshot_id: snapshot.id,
      session_id: sessionId,
      label: snapshot.label,
      captured_at_iso: snapshot.capturedAt,
      metrics_json: JSON.stringify(snapshot.metrics),
      result_json: JSON.stringify(snapshot.result)
    };
    this.insertSnapshotStmt.run(payload);
  }

  saveScores(snapshotId, scores) {
    const nowIso = new Date().toISOString();
    const insert = this.db.transaction((rows) => {
      for (const s of rows) {
        this.insertScoreStmt.run({
          snapshot_id: snapshotId,
          vo_id: s.id,
          category: s.category,
          stability: s.stability,
          novelty: s.novelty,
          reuse_hint: s.reuseHint,
          computed_at_iso: nowIso
        });
      }
    });
    insert(scores);
  }

  hydrateSessionSnapshots(session) {
    const rows = this.loadSessionSnapshotsStmt.all(session.id);
    for (const row of rows) {
      const metrics = JSON.parse(row.metrics_json);
      const result = JSON.parse(row.result_json);
      session.snapshots.push({
        id: row.snapshot_id,
        label: row.label,
        capturedAt: row.captured_at_iso,
        metrics,
        result
      });
    }
  }

  close() {
    this.db.close();
  }
}

export default Persistence;
