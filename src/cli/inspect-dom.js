#!/usr/bin/env node
// src/cli/inspect-dom.js
// CLI entrypoint to stabilize a DOM snapshot JSON and record it as a DOM sheet.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import DOMSheetStabilizer from "../stabilizers/DOMSheetStabilizer.js";
import Persistence from "../core/Persistence.js";
import ExcavationSessionManager from "../core/ExcavationSessionManager.js";
import VirtualObjectScoreEngine from "../core/VirtualObjectScoreEngine.js";
import VirtualObjectExcavator from "../core/VirtualObjectExcavator.js";
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
    "Usage: javaspectre-inspect-dom <dom-snapshot.json>\n\n" +
      "Takes an rrweb/Sentry-style DOM snapshot JSON, stabilizes it into\n" +
      "a DOM sheet, excavates virtual-objects from the sheet, and persists\n" +
      "results into javaspectre-catalog.sqlite3.\n"
  );
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    printUsage();
    process.exit(1);
  }

  const snapshotFile = args[0];
  let snapshot;
  try {
    snapshot = readJson(snapshotFile);
  } catch (err) {
    logger.error("failed-to-read-dom-snapshot", {
      file: snapshotFile,
      error: String(err)
    });
    process.exit(1);
  }

  const persistence = new Persistence({ ensureSchema: true });
  const sessionManager = new ExcavationSessionManager({
    maxDepth: 6,
    maxSnapshots: 10,
    persistence
  });
  const scorer = new VirtualObjectScoreEngine({ historyWindow: 20 });
  const stabilizer = new DOMSheetStabilizer();
  const excavator = new VirtualObjectExcavator({
    maxDepth: 6,
    maxArraySample: 8,
    includeDom: true
  });

  const session = sessionManager.startSession(
    `dom:${path.basename(snapshotFile)}`,
    {
      source: snapshotFile,
      type: "dom-snapshot",
      cwd: process.cwd()
    }
  );

  const domSheet = stabilizer.stabilizeSnapshot(snapshot, {
    traceId: null,
    correlationId: null
  });

  const excavationInput = {
    value: domSheet.domTree,
    domRoot: domSheet
  };

  const shallow = excavator.excavate(excavationInput);
  shallow.domSheets = [domSheet];
  const snap1 = sessionManager.addSnapshot(session.id, shallow, "shallow-dom");

  const deep = excavator.excavate(excavationInput);
  deep.domSheets = [domSheet];
  const snap2 = sessionManager.addSnapshot(session.id, deep, "deep-dom");

  const scores = scorer.scoreSnapshot(snap2);
  persistence.saveScores(snap2.id, scores);

  const report = {
    session: sessionManager.getSessionSummary(session.id),
    domSheet,
    scores
  };

  const outPath = path.join(
    process.cwd(),
    ".javaspectre-inspect-dom-report.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  logger.info("dom-excavation-finished", {
    reportPath: outPath,
    sessionId: session.id
  });

  persistence.close();

  // eslint-disable-next-line no-console
  console.log(`DOM excavation report written to ${outPath}`);
}

if (import.meta.url === `file://${__filename}`) {
  main();
}
