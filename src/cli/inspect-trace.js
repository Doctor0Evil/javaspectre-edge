#!/usr/bin/env node
// src/cli/inspect-trace.js
// CLI entrypoint to ingest an OpenTelemetry-style span batch and excavate endpoint/state-machine virtual-objects.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Persistence from "../core/Persistence.js";
import ExcavationSessionManager from "../core/ExcavationSessionManager.js";
import VirtualObjectScoreEngine from "../core/VirtualObjectScoreEngine.js";
import MultiPassEngine from "../inference/MultiPassEngine.js";
import logger from "../core/Logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readJson(filePath) {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

// Very lightweight endpoint clustering + FSM pattern extraction.
function shallowTracePass(spans) {
  const endpoints = new Map();

  for (const span of spans) {
    const method = span.http_method || span.attributes?.["http.method"];
    const route = span.http_route || span.attributes?.["http.route"];
    const status = span.status_code || span.attributes?.["http.status_code"];

    if (!method || !route) continue;
    const key = `${method} ${route}`;
    const ep = endpoints.get(key) || {
      key,
      method,
      route,
      statuses: new Set(),
      count: 0
    };
    if (status != null) {
      ep.statuses.add(String(status));
    }
    ep.count += 1;
    endpoints.set(key, ep);
  }

  const virtualObjects = [];
  const relationships = [];

  for (const ep of endpoints.values()) {
    const id = `endpoint_${ep.key}`;
    virtualObjects.push({
      id,
      category: "api-endpoint",
      signature: ep.key,
      method: ep.method,
      route: ep.route,
      statusSet: Array.from(ep.statuses),
      sampleCount: ep.count
    });
  }

  return { virtualObjects, relationships, domSheets: [] };
}

function regionSelectorFromShallow(shallowResult) {
  const regions = [];
  for (const vo of shallowResult.virtualObjects) {
    if (vo.category !== "api-endpoint") continue;
    if (vo.statusSet.some((s) => s.startsWith("5"))) {
      regions.push({ type: "endpoint", key: vo.signature });
    }
  }
  return regions;
}

function deepTracePass(spans, region) {
  const virtualObjects = [];
  const relationships = [];

  if (region.type === "endpoint") {
    const [method, route] = region.key.split(" ");
    const tracesById = new Map();

    for (const span of spans) {
      const sMethod = span.http_method || span.attributes?.["http.method"];
      const sRoute = span.http_route || span.attributes?.["http.route"];
      if (sMethod === method && sRoute === route) {
        const traceId = span.trace_id;
        if (!tracesById.has(traceId)) {
          tracesById.set(traceId, []);
        }
        tracesById.get(traceId).push(span);
      }
    }

    for (const [traceId, tSpans] of tracesById.entries()) {
      tSpans.sort((a, b) => a.start_time_ns - b.start_time_ns);
      const fsmId = `fsm_${method}_${route}_${traceId}`;

      const states = tSpans.map((s) => ({
        name: s.span_name,
        status:
          s.status_code || s.attributes?.["http.status_code"] || "UNKNOWN"
      }));

      virtualObjects.push({
        id: fsmId,
        category: "span-fsm",
        traceId,
        endpoint: region.key,
        states
      });

      for (let i = 1; i < states.length; i += 1) {
        relationships.push({
          from: `${fsmId}:${states[i - 1].name}`,
          to: `${fsmId}:${states[i].name}`,
          kind: "transition"
        });
      }
    }
  }

  return { virtualObjects, relationships, domSheets: [] };
}

function printUsage() {
  // eslint-disable-next-line no-console
  console.error(
    "Usage: javaspectre-inspect-trace <spans.json>\n\n" +
      "Takes an array of OpenTelemetry-style span JSON objects, performs\n" +
      "a shallow endpoint clustering pass and deep FSM mining on errorful\n" +
      "endpoints, and persists virtual-object scores.\n"
  );
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    printUsage();
    process.exit(1);
  }

  const spansFile = args[0];
  let spans;
  try {
    spans = readJson(spansFile);
  } catch (err) {
    logger.error("failed-to-read-spans", { file: spansFile, error: String(err) });
    process.exit(1);
  }
  if (!Array.isArray(spans)) {
    logger.error("spans-json-not-array", { file: spansFile });
    process.exit(1);
  }

  const persistence = new Persistence({ ensureSchema: true });
  const sessionManager = new ExcavationSessionManager({
    maxDepth: 6,
    maxSnapshots: 10,
    persistence
  });
  const scorer = new VirtualObjectScoreEngine({ historyWindow: 50 });
  const multiPass = new MultiPassEngine({ maxDeepRegions: 16 });

  const session = sessionManager.startSession(
    `trace:${path.basename(spansFile)}`,
    {
      source: spansFile,
      type: "otel-spans",
      cwd: process.cwd()
    }
  );

  const { shallowResult, deepResults } = multiPass.run({
    input: spans,
    shallowFn: shallowTracePass,
    deepFn: deepTracePass,
    regionSelector: regionSelectorFromShallow
  });

  const shallowSnap = sessionManager.addSnapshot(
    session.id,
    shallowResult,
    "shallow-trace"
  );

  const mergedDeep = {
    virtualObjects: [],
    relationships: [],
    domSheets: []
  };
  for (const { region, deep } of deepResults) {
    mergedDeep.virtualObjects.push(...deep.virtualObjects);
    mergedDeep.relationships.push(...deep.relationships);
  }

  const deepSnap = sessionManager.addSnapshot(
    session.id,
    mergedDeep,
    "deep-trace"
  );

  const scores = scorer.scoreSnapshot(deepSnap);
  persistence.saveScores(deepSnap.id, scores);

  const report = {
    session: sessionManager.getSessionSummary(session.id),
    shallow: shallowResult,
    deep: mergedDeep,
    scores
  };

  const outPath = path.join(
    process.cwd(),
    ".javaspectre-inspect-trace-report.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  logger.info("trace-excavation-finished", {
    reportPath: outPath,
    sessionId: session.id
  });

  persistence.close();

  // eslint-disable-next-line no-console
  console.log(`Trace excavation report written to ${outPath}`);
}

if (import.meta.url === `file://${__filename}`) {
  main();
}
