export class VirtualObjectScoreEngine {
  constructor(options = {}) {
    this.historyWindow =
      typeof options.historyWindow === "number" ? options.historyWindow : 10;
    this.objectHistory = new Map();
  }

  scoreSnapshot(snapshot) {
    const scores = [];
    for (const vo of snapshot.result.virtualObjects) {
      const key = this._makeKey(vo);
      const hist = this._getHistory(key);
      const stability = this._computeStability(hist);
      const novelty = this._computeNovelty(hist);
      const reuseHint = this._computeReuseHint(vo);

      this._updateHistory(key);

      scores.push({
        id: vo.id,
        category: vo.category || "unknown",
        stability,
        novelty,
        reuseHint
      });
    }
    return scores;
  }

  _makeKey(vo) {
    const cat = vo.category || "unknown";
    const sig =
      typeof vo.signature === "string"
        ? vo.signature
        : JSON.stringify(vo.fields || {});
    return `${cat}:${sig}`;
  }

  _getHistory(key) {
    if (!this.objectHistory.has(key)) {
      this.objectHistory.set(key, []);
    }
    return this.objectHistory.get(key);
  }

  _updateHistory(key) {
    const hist = this._getHistory(key);
    hist.push(Date.now());
    if (hist.length > this.historyWindow) {
      hist.shift();
    }
  }

  _computeStability(hist) {
    if (hist.length < 2) {
      return 0.2;
    }
    const intervals = [];
    for (let i = 1; i < hist.length; i += 1) {
      intervals.push(hist[i] - hist[i - 1]);
    }
    const avgInterval =
      intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const normalized = Math.max(
      0,
      Math.min(1, avgInterval / (24 * 60 * 60 * 1000))
    );
    return normalized;
  }

  _computeNovelty(hist) {
    if (hist.length === 1) {
      return 1.0;
    }
    if (hist.length === 0) {
      return 0.5;
    }
    const lastSeen = hist[hist.length - 1];
    const ageMs = Date.now() - lastSeen;
    const normalized = Math.max(
      0,
      Math.min(1, ageMs / (7 * 24 * 60 * 60 * 1000))
    );
    return normalized;
  }

  _computeReuseHint(vo) {
    const name = vo.selector || vo.ctor || vo.category || "object";
    const lowered = String(name).toLowerCase();
    if (lowered.includes("button")) {
      return "ui-action";
    }
    if (vo.category === "dom-tag" || vo.category === "dom-motif") {
      return "dom-structure";
    }
    if (vo.category === "struct" || vo.category === "api-schema") {
      return "api-schema";
    }
    return "misc";
  }
}

export default VirtualObjectScoreEngine;
