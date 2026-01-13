import logger from "../core/Logger.js";

export class JsonSchemaInferer {
  constructor(options = {}) {
    this.minSamples =
      typeof options.minSamples === "number" ? options.minSamples : 3;
  }

  inferSchemas(entries) {
    const buckets = new Map();

    for (const e of entries) {
      const key = this._endpointKey(e.method, e.url);
      const bucket = buckets.get(key) || { key, samples: [] };
      if (e.responseJson && typeof e.responseJson === "object") {
        bucket.samples.push(e.responseJson);
      }
      buckets.set(key, bucket);
    }

    const schemas = [];
    for (const bucket of buckets.values()) {
      if (bucket.samples.length < this.minSamples) {
        continue;
      }
      const schema = this._inferSchemaFromSamples(bucket.samples);
      schemas.push({
        endpointKey: bucket.key,
        version: 1,
        inferredAtNs: Date.now() * 1e6,
        confidence: schema.confidence,
        schemaJson: schema.schema
      });
      logger.info("json-schema-inferred", {
        endpointKey: bucket.key,
        confidence: schema.confidence
      });
    }
    return schemas;
  }

  _endpointKey(method, url) {
    const u = new URL(url, "http://dummy");
    const parts = u.pathname.split("/").filter(Boolean);
    const templated = parts
      .map((p) => (p.match(/^[0-9a-f-]{6,}$/i) ? "{id}" : p))
      .join("/");
    return `${method.toUpperCase()} /${templated}`;
  }

  _inferSchemaFromSamples(samples) {
    const fieldStats = {};
    const total = samples.length;

    for (const obj of samples) {
      this._walkObject(obj, "#", fieldStats);
    }

    const schema = {};
    let sumConfidence = 0;
    let fieldCount = 0;

    for (const [path, stats] of Object.entries(fieldStats)) {
      const presenceRate = stats.count / total;
      const dominantType = this._dominantType(stats.types);
      const fieldConf = presenceRate * stats.typeConsistency;
      schema[path] = {
        type: dominantType,
        presenceRate,
        examples: stats.examples.slice(0, 3)
      };
      sumConfidence += fieldConf;
      fieldCount += 1;
    }

    const avgConfidence =
      fieldCount > 0 ? sumConfidence / fieldCount : 0.0;

    return { schema, confidence: avgConfidence };
  }

  _walkObject(value, path, stats) {
    if (value === null || typeof value !== "object") {
      this._recordField(stats, path, value);
      return;
    }

    if (Array.isArray(value)) {
      const arrPath = `${path}[]`;
      for (const el of value) {
        this._walkObject(el, arrPath, stats);
      }
      return;
    }

    for (const [k, v] of Object.entries(value)) {
      const childPath = path === "#" ? k : `${path}.${k}`;
      this._walkObject(v, childPath, stats);
    }
  }

  _recordField(stats, path, value) {
    const t = this._typeOf(value);
    const s = stats[path] || {
      count: 0,
      types: {},
      examples: [],
      lastType: null,
      typeConsistency: 1.0
    };
    s.count += 1;
    s.types[t] = (s.types[t] || 0) + 1;
    if (s.examples.length < 5) {
      s.examples.push(value);
    }
    if (s.lastType && s.lastType !== t) {
      s.typeConsistency *= 0.8;
    }
    s.lastType = t;
    stats[path] = s;
  }

  _typeOf(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    return typeof v;
  }

  _dominantType(types) {
    let best = "unknown";
    let bestCount = -1;
    for (const [t, c] of Object.entries(types)) {
      if (c > bestCount) {
        best = t;
        bestCount = c;
      }
    }
    return best;
  }
}

export default JsonSchemaInferer;
