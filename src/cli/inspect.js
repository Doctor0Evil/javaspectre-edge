#!/usr/bin/env node
// src/cli/inspect.js
// CLI entrypoint to run a multi-pass excavation and scoring over a JSON value.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import VirtualObjectExcavator from "../core/VirtualObjectExcavator.js";
import ExcavationSessionManager from "../core/ExcavationSessionManager.js";
import VirtualObjectScoreEngine from "../core/VirtualObjectScoreEngine.js";
import Persistence from "../core/Persistence.js";
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
    "Usage: javaspectre-inspect <json-file>\n\n" +
      "Runs a shallow+deep virtual-object excavation over the JSON payload,\n" +
      "persists results into javaspectre-catalog.sqlite3, and writes a\n" +
      "human-readable report to .javaspectre-inspect-report.json.\n"
  );
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    printUsage();
    process.exit(1);
  }

  const jsonFile = args[0];
  let data;
  try {
    data = readJson(jsonFile);
  } catch (err) {
    logger.error("failed-to-read-json", {
      file: jsonFile,
      error: String(err)
    });
    process.exit(1);
  }

  const persistence = new Persistence({ ensureSchema: true });
  const excavator = new VirtualObjectExcavator({
    maxDepth: 6,
    maxArraySample: 8,
    includeDom: false
  });
  const sessionManager = new ExcavationSessionManager({
    maxDepth: 6,
    maxSnapshots: 10,
    persistence
  });
  const scorer = new VirtualObjectScoreEngine({
    historyWindow: 20
  });

  const session = sessionManager.startSession(
    `json:${path.basename(jsonFile)}`,
    {
      source: jsonFile,
      type: "json-file",
      cwd: process.cwd()
    }
  );

  const shallow = excavator.excavate({ value: data, domRoot: null });
  const snap1 = sessionManager.addSnapshot(session.id, shallow, "shallow");

  const deep = excavator.excavate({ value: data, domRoot: null });
  const snap2 = sessionManager.addSnapshot(session.id, deep, "deep");

  const scores = scorer.scoreSnapshot(snap2);
  persistence.saveScores(snap2.id, scores);

  const report = {
    session: sessionManager.getSessionSummary(session.id),
    scores
  };

  const outPath = path.join(
    process.cwd(),
    ".javaspectre-inspect-report.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  logger.info("excavation-finished", {
    reportPath: outPath,
    sessionId: session.id
  });

  persistence.close();

  // eslint-disable-next-line no-console
  console.log(`Excavation report written to ${outPath}`);
}

if (import.meta.url === `file://${__filename}`) {
  main();
}
