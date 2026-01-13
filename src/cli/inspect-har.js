#!/usr/bin/env node
// src/cli/inspect-har.js
// CLI entrypoint to ingest a HAR file, infer JSON schemas, and store them.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Persistence from "../core/Persistence.js";
import ExcavationSessionManager from "../core/ExcavationSessionManager.js";
import VirtualObjectScoreEngine from "../core/VirtualObjectScoreEngine.js";
import VirtualObjectExcavator from "../core/VirtualObjectExcavator.js";
import HarIngestor from "../ingest/HarIngestor.js";
import JsonSchemaInferer from "../ingest/JsonSchemaInferer.js";
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

function printUsage() {
  // eslint-disable-next-line no-console
  console.error(
    "Usage: javaspectre-inspect-har <session.har>\n\n" +
      "Parses a HAR file, infers JSON schemas per endpoint, excavates\n" +
      "virtual-objects from the combined schema+payloads, and persists\n" +
      "scores into javaspectre-catalog.sqlite3.\n"
  );
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    printUsage();
    process.exit(1);
  }

  const harFile = args[0];
  let harJson;
  try {
    harJson = readJson(harFile);
  } catch (err) {
    logger.error("failed-to-read-har", { file: harFile, error: String(err) });
    process.exit(1);
  }

  const persistence = new Persistence({ ensureSchema: true });
  const sessionManager = new ExcavationSessionManager({
    maxDepth: 6,
    maxSnapshots: 10,
    persistence
  });
  const scorer = new VirtualObjectScoreEngine({ historyWindow: 30 });
  const excavator = new VirtualObjectExcavator({
    maxDepth: 6,
    maxArraySample: 8,
    includeDom: false
  });
  const harIngestor = new HarIngestor();
  const schemaInferer = new JsonSchemaInferer({ minSamples: 3 });

  const session = sessionManager.startSession(
    `har:${path.basename(harFile)}`,
    {
      source: harFile,
      type: "har-file",
      cwd: process.cwd()
    }
  );

  const entries = harIngestor.extractEntries(harJson);
  const schemas = schemaInferer.inferSchemas(entries);

  const excavationInput = {
    value: { schemas, entries },
    domRoot: null
  };

  const shallow = excavator.excavate(excavationInput);
  const snap1 = sessionManager.addSnapshot(
    session.id,
    shallow,
    "shallow-har"
  );

  const deep = excavator.excavate(excavationInput);
  const snap2 = sessionManager.addSnapshot(session.id, deep, "deep-har");

  const scores = scorer.scoreSnapshot(snap2);
  persistence.saveScores(snap2.id, scores);

  const report = {
    session: sessionManager.getSessionSummary(session.id),
    schemas,
    scores
  };

  const outPath = path.join(
    process.cwd(),
    ".javaspectre-inspect-har-report.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  logger.info("har-excavation-finished", {
    reportPath: outPath,
    sessionId: session.id
  });

  persistence.close();

  // eslint-disable-next-line no-console
  console.log(`HAR excavation report written to ${outPath}`);
}

if (import.meta.url === `file://${__filename}`) {
  main();
}
