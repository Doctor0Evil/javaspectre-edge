import logger from "../core/Logger.js";

export class HarIngestor {
  constructor(options = {}) {
    this.maxEntries =
      typeof options.maxEntries === "number" ? options.maxEntries : 10000;
  }

  /**
   * @param {Object} harJson - Parsed HAR JSON (log.pages, log.entries)
   * @returns {Array<Object>} entries with normalized fields
   */
  extractEntries(harJson) {
    const log = harJson && harJson.log ? harJson.log : harJson;
    if (!log || !Array.isArray(log.entries)) {
      logger.warn("har-log-missing-entries");
      return [];
    }

    const out = [];
    for (const entry of log.entries.slice(0, this.maxEntries)) {
      const req = entry.request || {};
      const res = entry.response || {};
      const started = entry.startedDateTime
        ? Date.parse(entry.startedDateTime)
        : Date.now();

      const method = req.method || "GET";
      const url = req.url || "";
      const status = res.status || 0;

      const reqJson = this._parseJsonBody(req.postData);
      const resJson = this._parseJsonBody(res.content);

      out.push({
        entryId: this._entryId(entry),
        correlationId: this._correlationId(entry),
        startedAtNs: started * 1e6,
        method,
        url,
        status,
        requestJson: reqJson,
        responseJson: resJson,
        rawEntry: entry
      });
    }

    logger.info("har-entries-extracted", { count: out.length });
    return out;
  }

  _parseJsonBody(content) {
    if (!content) return null;
    const mime =
      content.mimeType ||
      content["content-type"] ||
      content.headers?.["content-type"] ||
      "";
    const isJson =
      mime.includes("application/json") || mime.includes("+json");
    if (!isJson) return null;
    const text = content.text || content.value || "";
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_err) {
      return null;
    }
  }

  _entryId(entry) {
    if (entry._id) return String(entry._id);
    if (entry.pageref && entry.request && entry.request.url) {
      return `${entry.pageref}:${entry.request.url}:${entry.startedDateTime}`;
    }
    return `har_${Math.random().toString(36).slice(2)}`;
  }

  _correlationId(entry) {
    if (entry.request && Array.isArray(entry.request.headers)) {
      const hdr = entry.request.headers.find(
        (h) =>
          h.name.toLowerCase() === "x-correlation-id" ||
          h.name.toLowerCase() === "x-request-id"
      );
      if (hdr && hdr.value) return String(hdr.value);
    }
    return null;
  }
}

export default HarIngestor;
