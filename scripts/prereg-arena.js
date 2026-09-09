#!/usr/bin/env node
/**
 * Preregister, draw and verify a Quantum Policy Tic-Tac-Toe hardware validation.
 *
 *   node scripts/prereg-arena.js register --draw-after 2h
 *   node scripts/prereg-arena.js draw <hash-prefix>        # needs IBM_QUANTUM_TOKEN
 *   node scripts/prereg-arena.js verify <hash-prefix>
 *   node scripts/prereg-arena.js list
 *
 * `draw` executes on real hardware and costs real queue time. It refuses to run
 * before drawAfter, refuses without a token, and refuses to publish simulator
 * output as a hardware result.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { fetchBeaconAtOrAfter } = require("../server/prereg");
const { createArenaRegistration, sealArenaResult, verifyArenaResult } = require("../server/arenaPrereg");

const DIR = path.join(__dirname, "..", "preregistrations", "arena");
const regPath = (h) => path.join(DIR, `${h.slice(0, 16)}.registration.json`);
const resPath = (h) => path.join(DIR, `${h.slice(0, 16)}.result.json`);

const HALF_PI = Math.PI / 2;

// The cells, fixed here rather than passed on the command line — a flag is a
// choice that can be made after seeing a pilot.
const CELLS = [
  { operationX: "C", operationO: "D", gamma: 0 },
  { operationX: "D", operationO: "C", gamma: 0 },
  { operationX: "C", operationO: "D", gamma: HALF_PI },
  { operationX: "D", operationO: "C", gamma: HALF_PI },
  { operationX: "Q", operationO: "Q", gamma: HALF_PI },
  { operationX: "M", operationO: "M", gamma: HALF_PI / 2 },
  { operationX: "M", operationO: "Q", gamma: HALF_PI },
];

function parseDuration(text) {
  const match = /^(\d+)([mhd])$/.exec(text || "");
  if (!match) throw new Error("--draw-after must look like 30m, 2h or 1d");
  const scale = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return Number(match[1]) * scale;
}

function flag(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

function loadRegistration(prefix) {
  const file = fs.readdirSync(DIR).find((n) => n.startsWith(prefix) && n.endsWith(".registration.json"));
  if (!file) throw new Error(`no registration matching ${prefix}`);
  return { record: JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")), file };
}

function cmdRegister(argv) {
  fs.mkdirSync(DIR, { recursive: true });
  const drawAfterMs = Date.now() + parseDuration(flag(argv, "draw-after") || "2h");
  const basisFile = path.join(DIR, "threshold-basis.json");
  if (!fs.existsSync(basisFile)) {
    throw new Error(`threshold basis missing at ${basisFile} — the threshold must be derived before registering`);
  }
  const thresholdBasis = JSON.parse(fs.readFileSync(basisFile, "utf8"));

  const { record, hash } = createArenaRegistration({
    cells: CELLS,
    shotsPerCell: 4096,
    backend: process.env.IBM_QUANTUM_BACKEND || "ibm_marrakesh",
    tvdThreshold: thresholdBasis.threshold,
    thresholdBasis,
    drawAfterMs,
  });
  fs.writeFileSync(regPath(hash), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`registered   ${hash}`);
  console.log(`  cells      ${record.cells.length} x ${record.shotsPerCell} shots on ${record.backend}`);
  console.log(`  threshold  TVD <= ${record.tvdThreshold} per cell (${thresholdBasis.method})`);
  console.log(`  draw after ${record.drawAfter}`);
  console.log(`  entropy    ${record.beaconUri}`);
  console.log(`\n  file       ${regPath(hash)}`);
}

async function cmdDraw(argv) {
  const prefix = argv[0];
  if (!prefix) throw new Error("usage: draw <hash-prefix>");
  const { record: registration } = loadRegistration(prefix);
  const hash = require("../server/prereg").hashRecord(registration);

  const drawAfter = Date.parse(registration.drawAfter);
  if (Date.now() < drawAfter) {
    throw new Error(`too early — drawAfter is ${registration.drawAfter}`);
  }
  if (!process.env.IBM_QUANTUM_TOKEN) {
    throw new Error("IBM_QUANTUM_TOKEN is not set; this registration publishes hardware results only");
  }

  const beacon = await fetchBeaconAtOrAfter(drawAfter);
  console.log(`  pulse #${beacon.pulseIndex} @ ${beacon.timeStamp}\n`);

  const runner = path.join(__dirname, "..", "python-bridge", "run_arena_validation.py");
  const raw = execFileSync(process.env.PYTHON || "python3", [runner], {
    input: JSON.stringify({ cells: registration.cells, shots: registration.shotsPerCell, backend: registration.backend }),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const { cells, backendReported } = JSON.parse(raw);

  if (cells.some((c) => c.simulator !== false)) {
    throw new Error("a cell fell back to the simulator; refusing to publish it as a hardware result");
  }

  const { record: result } = sealArenaResult({ registrationHash: hash, beacon, cells, backendReported });
  fs.writeFileSync(resPath(hash), `${JSON.stringify(result, null, 2)}\n`);
  const worst = Math.max(...cells.map((c) => c.tvd));
  console.log(`  worst TVD  ${worst.toFixed(4)} (threshold ${registration.tvdThreshold})`);
  console.log(`  ${worst <= registration.tvdThreshold ? "hypothesis upheld" : "HYPOTHESIS FALSIFIED"}`);
  console.log(`\n  file       ${resPath(hash)}`);
}

async function cmdVerify(argv) {
  const { record: registration } = loadRegistration(argv[0]);
  const hash = require("../server/prereg").hashRecord(registration);
  if (!fs.existsSync(resPath(hash))) throw new Error("no result published for that registration yet");
  const result = JSON.parse(fs.readFileSync(resPath(hash), "utf8"));
  const report = await verifyArenaResult({ registration, result });
  for (const check of report.checks) {
    console.log(`  ${check.ok ? "ok  " : "FAIL"} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }
  console.log(`\n  verified          ${report.verified}`);
  console.log(`  hypothesis upheld ${report.hypothesisUpheld}`);
  if (!report.hypothesisUpheld) console.log("  exceeded:", JSON.stringify(report.cellsExceedingThreshold, null, 2));
  process.exitCode = report.verified ? 0 : 1;
}

function cmdList() {
  if (!fs.existsSync(DIR)) return console.log("no arena registrations yet");
  for (const file of fs.readdirSync(DIR).filter((n) => n.endsWith(".registration.json"))) {
    const record = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    const drawn = fs.existsSync(path.join(DIR, file.replace(".registration.", ".result.")));
    console.log(`  ${file.slice(0, 16)}  ${record.backend}  ${record.cells.length} cells  ${drawn ? "drawn" : "not drawn"}`);
  }
}

const [command, ...rest] = process.argv.slice(2);
const commands = { register: cmdRegister, draw: cmdDraw, verify: cmdVerify, list: cmdList };
if (!commands[command]) {
  console.error("usage: prereg-arena.js <register|draw|verify|list> [args]");
  process.exit(1);
}
Promise.resolve(commands[command](rest)).catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
