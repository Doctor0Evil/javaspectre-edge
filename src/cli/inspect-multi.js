import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ExcavationSessionManager from "../core/ExcavationSessionManager.js";
import VirtualObjectScoreEngine from "../core/VirtualObjectScoreEngine.js";
import VirtualObjectExcavator from "../core/VirtualObjectExcavator.js";
import DOMSheetMapper from "../dom/DOMSheetMapper.js";
import PhantomDetector from "../trace/PhantomDetector.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readJson(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

function loadInput(mode, filePath) {
  const data = readJson(filePath);
  if (mode === "json") {
    return { kind: "json", value: data };
  }
  if (mode === "dom") {
    return { kind: "dom", domSnapshot: data };
  }
  if (mode === "trace") {
    return { kind: "trace", traceLog: data };
  }
  throw new Error(`Unsupported mode: ${mode}`);
}

function buildExcavationResult(mode, input, excavator) {
  if (mode === "json") {
    return excavator.excavate({ value: input.value, domRoot: null });
  }
  if (mode === "dom") {
    const domSheet = DOMSheetMapper.fromSnapshot(input.domSnapshot);
    const base = excavator.excavate({ value: null, domRoot: domSheet.root });
    base.domSheets = [domSheet];
    return base;
  }
  if (mode === "trace") {
    const phantoms = PhantomDetector.fromTraceLog(input.traceLog);
    const base = excavator.excavate({ value: input.traceLog, domRoot: null });
    base.phantoms = phantoms;
    return base;
  }
  throw new Error(`Unsupported mode: ${mode}`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    // eslint-disable-next-line no-console
    console.error("Usage: node inspect-multi.js --mode json|dom|trace <input-file>");
    process.exit(1);
  }

  const modeFlagIndex = args.indexOf("--mode");
  if (modeFlagIndex === -1 || modeFlagIndex === args.length - 1) {
    // eslint-disable-next-line no-console
    console.error("Missing or invalid --mode flag");
    process.exit(1);
  }

  const mode = args[modeFlagIndex + 1];
  const fileArgIndex = modeFlagIndex === 0 ? 2 : 1;
  const inputFile = args[fileArgIndex];

  const input = loadInput(mode, inputFile);

  const sessionManager = new ExcavationSessionManager({
    maxDepth: 6,
    maxSnapshots: 5
  });
  const scorer = new VirtualObjectScoreEngine({
    historyWindow: 20
  });
  const excavator = new VirtualObjectExcavator({
    maxDepth: 6,
    maxArraySample: 16,
    includeDom: mode === "dom"
  });

  const sessionId = `${mode}:${path.basename(inputFile)}`;
  const session = sessionManager.startSession(sessionId, {
    source: inputFile,
    mode
  });

  const shallowResult = buildExcavationResult(mode, input, excavator);
  sessionManager.addSnapshot(session.id, shallowResult, "shallow");

  const deepResult = buildExcavationResult(mode, input, excavator);
  const deepSnapshot = sessionManager.addSnapshot(session.id, deepResult, "deep");

  const scores = scorer.scoreSnapshot(deepSnapshot);

  const report = {
    session: sessionManager.getSessionSummary(session.id),
    scores
  };

  const outPath = path.join(
    process.cwd(),
    `.javaspectre-inspect-report.${mode}.json`
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Javaspectre ${mode} excavation report written to ${outPath}`);
}

if (import.meta.url === `file://${__filename}`) {
  main();
}
