import logger from "./Logger.js";

export class ExcavationSessionManager {
  constructor(options = {}) {
    this.maxDepth = typeof options.maxDepth === "number" ? options.maxDepth : 6;
    this.maxSnapshots =
      typeof options.maxSnapshots === "number" ? options.maxSnapshots : 20;
    this.sessions = new Map();
    this.persistence = options.persistence || null;
  }

  startSession(sessionId, metadata = {}) {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId);
    }
    const session = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      metadata,
      snapshots: [],
      summary: {
        totalVirtualObjects: 0,
        totalRelationships: 0,
        domSheets: 0,
        driftEvents: 0
      }
    };
    if (this.persistence) {
      this.persistence.saveSession(session);
      this.persistence.hydrateSessionSnapshots(session);
      this._updateSummary(session);
    }
    this.sessions.set(sessionId, session);
    logger.info("session-started", { sessionId });
    return session;
  }

  addSnapshot(sessionId, excavationResult, label = "default") {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown excavation session: ${sessionId}`);
    }
    const snapshot = {
      id: `${sessionId}:${session.snapshots.length}`,
      label,
      capturedAt: new Date().toISOString(),
      metrics: {
        virtualObjects: excavationResult.virtualObjects.length,
        relationships: excavationResult.relationships.length,
        domSheets: excavationResult.domSheets
          ? excavationResult.domSheets.length
          : 0
      },
      result: excavationResult
    };
    session.snapshots.push(snapshot);
    if (session.snapshots.length > this.maxSnapshots) {
      session.snapshots.shift();
    }

    this._updateSummary(session);
    this._detectDrift(session);

    if (this.persistence) {
      this.persistence.saveSnapshot(session.id, snapshot);
    }

    logger.info("snapshot-added", {
      sessionId,
      label,
      snapshotId: snapshot.id,
      metrics: snapshot.metrics
    });

    return snapshot;
  }

  _updateSummary(session) {
    let totalVO = 0;
    let totalRel = 0;
    let sheets = 0;
    for (const snap of session.snapshots) {
      totalVO += snap.metrics.virtualObjects;
      totalRel += snap.metrics.relationships;
      sheets += snap.metrics.domSheets;
    }
    session.summary.totalVirtualObjects = totalVO;
    session.summary.totalRelationships = totalRel;
    session.summary.domSheets = sheets;
  }

  _detectDrift(session) {
    if (session.snapshots.length < 2) {
      return;
    }
    const latest = session.snapshots[session.snapshots.length - 1];
    const prev = session.snapshots[session.snapshots.length - 2];

    const voDelta = Math.abs(
      latest.metrics.virtualObjects - prev.metrics.virtualObjects
    );
    const relDelta = Math.abs(
      latest.metrics.relationships - prev.metrics.relationships
    );

    const driftScore = voDelta + relDelta;
    if (driftScore > 0) {
      session.summary.driftEvents += 1;
      logger.debug("drift-detected", {
        sessionId: session.id,
        latestId: latest.id,
        prevId: prev.id,
        voDelta,
        relDelta
      });
    }
  }

  getSessionSummary(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown excavation session: ${sessionId}`);
    }
    return {
      id: session.id,
      createdAt: session.createdAt,
      metadata: session.metadata,
      summary: session.summary,
      snapshots: session.snapshots.map((snap) => ({
        id: snap.id,
        label: snap.label,
        capturedAt: snap.capturedAt,
        metrics: snap.metrics
      }))
    };
  }

  listSessions() {
    const result = [];
    for (const session of this.sessions.values()) {
      result.push({
        id: session.id,
        createdAt: session.createdAt,
        metadata: session.metadata,
        summary: session.summary
      });
    }
    return result;
  }
}

export default ExcavationSessionManager;
