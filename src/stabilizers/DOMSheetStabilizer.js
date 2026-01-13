import logger from "../core/Logger.js";

const DEFAULT_DYNAMIC_ID_REGEX = /(\\b|^)([0-9a-f]{8,}|[A-Z0-9]{10,})(\\b|$)/i;

export class DOMSheetStabilizer {
  constructor(options = {}) {
    this.dynamicIdRegex =
      options.dynamicIdRegex || DEFAULT_DYNAMIC_ID_REGEX;
    this.maxNodes =
      typeof options.maxNodes === "number" ? options.maxNodes : 5000;
    this.abVariantPrefixes = options.abVariantPrefixes || ["ab-", "exp-"];
  }

  /**
   * Stabilize a raw DOM snapshot into a "DOM sheet".
   *
   * @param {Object} snapshot - rrweb/Sentry-style snapshot JSON
   * @param {Object} context  - { traceId?, correlationId? }
   * @returns {Object} { sheetId, traceId, correlationId, domStabilityScore, domTree, noiseStats }
   */
  stabilizeSnapshot(snapshot, context = {}) {
    const nodes = [];
    const noiseStats = {
      dynamicIdsStripped: 0,
      hydrationArtifactsStripped: 0,
      abClassesBucketed: 0,
      totalNodes: 0
    };

    const root = snapshot && snapshot.dom && snapshot.dom.root
      ? snapshot.dom.root
      : snapshot;

    this._walkNode(root, null, "#", 0, nodes, noiseStats);

    const domTree = {
      nodeCount: nodes.length,
      nodes
    };

    const domStabilityScore = this._estimateStability(domTree, noiseStats);

    const sheetId = context.sheetId || `sheet_${Date.now().toString(36)}`;

    logger.info("dom-sheet-stabilized", {
      sheetId,
      traceId: context.traceId,
      correlationId: context.correlationId,
      nodeCount: nodes.length,
      noiseStats
    });

    return {
      sheetId,
      traceId: context.traceId || null,
      correlationId: context.correlationId || null,
      domStabilityScore,
      domTree,
      noiseStats
    };
  }

  _walkNode(node, parentId, path, depth, outNodes, noiseStats) {
    if (!node || outNodes.length >= this.maxNodes) {
      return;
    }
    if (typeof node !== "object") {
      return;
    }

    const nodeId = node.id ?? `n_${outNodes.length.toString(36)}`;
    const tagName = (node.tagName || node.tag || "unknown").toLowerCase();

    const rawAttrs = node.attributes || node.attrs || {};
    const { attrs, noise } = this._normalizeAttributes(rawAttrs);
    noiseStats.dynamicIdsStripped += noise.dynamicIdsStripped;
    noiseStats.hydrationArtifactsStripped +=
      noise.hydrationArtifactsStripped;
    noiseStats.abClassesBucketed += noise.abClassesBucketed;

    const sheetNode = {
      id: nodeId,
      parentId,
      path,
      tagName,
      role: attrs.role || null,
      data: this._extractDataAttrs(attrs),
      classes: attrs.class || [],
      stableId: attrs.id || null,
      children: []
    };

    outNodes.push(sheetNode);
    noiseStats.totalNodes += 1;

    const childNodes = node.childNodes || node.children || [];
    childNodes.forEach((child, idx) => {
      const childPath = `${path}/${tagName}[${idx}]`;
      this._walkNode(child, nodeId, childPath, depth + 1, outNodes, noiseStats);
    });
  }

  _normalizeAttributes(attrs) {
    const out = {};
    const noise = {
      dynamicIdsStripped: 0,
      hydrationArtifactsStripped: 0,
      abClassesBucketed: 0
    };

    let classList = [];
    for (const [name, value] of Object.entries(attrs)) {
      const lower = name.toLowerCase();
      if (lower === "id") {
        if (this.dynamicIdRegex.test(String(value))) {
          noise.dynamicIdsStripped += 1;
          continue;
        }
        out.id = String(value);
        continue;
      }
      if (lower === "data-hydration" || lower === "data-ssr") {
        noise.hydrationArtifactsStripped += 1;
        continue;
      }
      if (lower === "class" || lower === "className") {
        const rawClasses = String(value).split(/\s+/).filter(Boolean);
        classList = this._normalizeClasses(rawClasses, noise);
        out.class = classList;
        continue;
      }
      if (lower === "role") {
        out.role = String(value);
        continue;
      }
      out[name] = value;
    }

    if (!out.class && classList.length > 0) {
      out.class = classList;
    }

    return { attrs: out, noise };
  }

  _normalizeClasses(classes, noise) {
    const normalized = [];
    for (const c of classes) {
      const lowered = c.toLowerCase();
      const isAb = this.abVariantPrefixes.some((p) =>
        lowered.startsWith(p)
      );
      if (isAb) {
        normalized.push("ab-variant");
        noise.abClassesBucketed += 1;
      } else {
        normalized.push(c);
      }
    }
    return Array.from(new Set(normalized));
  }

  _extractDataAttrs(attrs) {
    const data = {};
    for (const [name, value] of Object.entries(attrs)) {
      if (name.toLowerCase().startsWith("data-")) {
        data[name] = value;
      }
    }
    return data;
  }

  _estimateStability(domTree, noiseStats) {
    if (domTree.nodeCount === 0) {
      return 0;
    }
    const noisyEvents =
      noiseStats.dynamicIdsStripped +
      noiseStats.hydrationArtifactsStripped +
      noiseStats.abClassesBucketed;
    const ratio = noisyEvents / (domTree.nodeCount || 1);
    const score = Math.max(0, Math.min(1, 1 - ratio));
    return score;
  }
}

export default DOMSheetStabilizer;
