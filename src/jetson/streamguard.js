import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import EventEmitter from "node:events";
import mqtt from "mqtt";
import { Logger } from "../core/Logger.js";

const logger = new Logger("streamguard");

export class StreamGuard extends EventEmitter {
  constructor(options = {}) {
    super();
    this.deviceId = options.deviceId || process.env.DEVICE_ID || "jetson-1";
    this.zoneId = options.zoneId || process.env.ZONE_ID || "phoenix-zone-1";

    this.mqttUrl = options.mqttUrl || "mqtt://localhost:1883";
    this.mqttTopic =
      options.mqttTopic || "analytics/phoenix-displays/events";

    this.deepstreamFeedPath =
      options.deepstreamFeedPath ||
      process.env.DEEPSTREAM_FEED_PATH ||
      "/var/run/deepstream-events.ndjson";

    this.audioFeedPath =
      options.audioFeedPath ||
      process.env.AUDIO_FEED_PATH ||
      "/var/run/aug-sound-events.ndjson";

    this.client = null;
    this.fileWatchers = [];
  }

  start() {
    this._connectMqtt();
    this._attachNdjsonFeed(this.deepstreamFeedPath, "vision");
    this._attachNdjsonFeed(this.audioFeedPath, "audio");
    logger.info("streamguard-started", {
      deviceId: this.deviceId,
      zoneId: this.zoneId,
      mqttUrl: this.mqttUrl,
      mqttTopic: this.mqttTopic
    });
  }

  stop() {
    for (const w of this.fileWatchers) {
      try {
        w.close();
      } catch (_) {
        // ignore
      }
    }
    this.fileWatchers = [];
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    logger.info("streamguard-stopped", {});
  }

  _connectMqtt() {
    this.client = mqtt.connect(this.mqttUrl);
    this.client.on("connect", () => {
      logger.info("mqtt-connected", { url: this.mqttUrl });
    });
    this.client.on("error", (err) => {
      logger.error("mqtt-error", { error: String(err) });
    });
  }

  _attachNdjsonFeed(filePath, kind) {
    // Very simple NDJSON tailer; in production, you may want inotify or
    // a dedicated DeepStream plugin that writes to a Unix socket instead.
    try {
      const abs = path.isAbsolute(filePath)
        ? filePath
        : path.join(process.cwd(), filePath);

      const stream = fs.createReadStream(abs, {
        encoding: "utf8",
        flags: "a+"
      });

      let buffer = "";
      stream.on("data", (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          this._handleRawEventLine(line, kind);
        }
      });

      stream.on("error", (err) => {
        logger.error("feed-stream-error", { filePath: abs, error: String(err) });
      });

      this.fileWatchers.push(stream);
      logger.info("ndjson-feed-attached", { filePath: abs, kind });
    } catch (err) {
      logger.error("ndjson-feed-init-failed", {
        filePath,
        kind,
        error: String(err)
      });
    }
  }

  _handleRawEventLine(line, kind) {
    let raw;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      logger.warn("ndjson-parse-error", { kind, error: String(err) });
      return;
    }
    const voEvent = this._normalizeToVirtualObjectEvent(raw, kind);
    this._publishVirtualObjectEvent(voEvent);
    this.emit("vo-event", voEvent);
  }

  _normalizeToVirtualObjectEvent(raw, kind) {
    const ts = Date.now();
    const eventId = `voevt_${ts.toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    // DeepStream vision metadata example shape (pseudo):
    // {
    //   "stream_id": "display-1",
    //   "frame_id": 12345,
    //   "objects": [
    //     { "class": "person", "bbox": [...], "confidence": 0.91, "zone": "A" },
    //     ...
    //   ],
    //   "policy_flags": ["no-helmet", "crowd-density-high"]
    // }
    //
    // AugSound audio example (pseudo):
    // {
    //   "microphone_id": "mic-1",
    //   "peak_db": 78.2,
    //   "speech_prob": 0.83,
    //   "keywords": ["emergency", "help"],
    //   "policy_flags": ["speech-detected"]
    // }

    const base = {
      device_id:
        raw.device_id ||
        raw.stream_id ||
        raw.microphone_id ||
        this.deviceId,
      zone_id: raw.zone || raw.zone_id || this.zoneId,
      category: kind === "vision" ? "vision-compliance" : "audio-compliance"
    };

    const fields = {
      kind,
      frame_id: raw.frame_id ?? null,
      objects: raw.objects || null,
      peak_db: raw.peak_db ?? null,
      speech_prob: raw.speech_prob ?? null,
      keywords: raw.keywords || null,
      policy_flags: raw.policy_flags || [],
      raw
    };

    return {
      event_id: eventId,
      ts_unix_ms: ts,
      device_id: base.device_id,
      zone_id: base.zone_id,
      category: base.category,
      fields
    };
  }

  _publishVirtualObjectEvent(voEvent) {
    if (!this.client || !this.client.connected) {
      logger.warn("mqtt-not-connected-skip", { event_id: voEvent.event_id });
      return;
    }
    const payload = JSON.stringify(voEvent);
    this.client.publish(this.mqttTopic, payload, { qos: 1 }, (err) => {
      if (err) {
        logger.error("mqtt-publish-error", {
          topic: this.mqttTopic,
          error: String(err)
        });
      }
    });
  }
}

// If executed directly, run as a standalone daemon.
if (process.argv[1] && process.argv[1].endsWith("streamguard.js")) {
  const sg = new StreamGuard({});
  sg.start();

  process.on("SIGINT", () => {
    logger.info("streamguard-sigint", {});
    sg.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    logger.info("streamguard-sigterm", {});
    sg.stop();
    process.exit(0);
  });
}
