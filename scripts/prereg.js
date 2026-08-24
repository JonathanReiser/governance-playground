#!/usr/bin/env node
/**
 * scripts/prereg.js — the operator-facing half of pre-registration.
 *
 *   node scripts/prereg.js register <scenarioId> [--cycles 10] [--in 15m]
 *   node scripts/prereg.js draw     <registrationHash>
 *   node scripts/prereg.js verify   <registrationHash>
 *   node scripts/prereg.js list
 *
 * `register` writes a public promise and prints its hash. `draw` waits for the
 * registered NIST pulse to exist, fetches it, and seals whatever the run
 * produced against it. `verify` re-derives everything a stranger could check.
 *
 * Registrations and results are written to preregistrations/ as plain JSON so
 * they can be committed to git — a registration whose result never lands is
 * supposed to stay visible in the history. That visibility is the mechanism.
 */

const fs = require("fs");
const path = require("path");
const {
  createRegistration, sealRun, verifyRun, fetchBeaconAtOrAfter, hashRecord,
} = require("../server/prereg");

const DIR = path.join(__dirname, "..", "preregistrations");
const regPath = (h) => path.join(DIR, `${h.slice(0, 16)}.registration.json`);
const resPath = (h) => path.join(DIR, `${h.slice(0, 16)}.result.json`);

function parseDuration(s) {
  const m = /^(\d+)(m|h)$/.exec(s || "");
  if (!m) throw new Error(`--in wants a duration like 15m or 2h, got: ${s}`);
  return Number(m[1]) * (m[2] === "m" ? 60_000 : 3_600_000);
}

function loadRegistration(hashPrefix) {
  const file = fs.readdirSync(DIR).find((f) => f.startsWith(hashPrefix.slice(0, 16)) && f.endsWith(".registration.json"));
  if (!file) throw new Error(`No registration found matching ${hashPrefix}`);
  const record = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
  return { record, hash: hashRecord(record) };
}

async function cmdRegister(argv) {
  const scenarioId = argv[0];
  if (!scenarioId) throw new Error("usage: prereg register <scenarioId> [--cycles N] [--in 15m]");
  const cycles = Number(flag(argv, "--cycles") ?? 10);
  const delayMs = parseDuration(flag(argv, "--in") ?? "15m");
  const mode = flag(argv, "--mode") ?? "ai-quantum-tier1";

  const { agentContract } = require("../server.js");
  const doctrine = agentContract.doctrineOf(scenarioId);
  const schemas = agentContract.DECISION_SCHEMAS[scenarioId];
  if (!schemas) throw new Error(`No decision schemas registered for scenario: ${scenarioId}`);

  const drawAfterMs = Date.now() + delayMs;
  const { record, hash } = createRegistration({
    scenarioId, cycles, mode,
    agentModel: agentContract.AGENT_MODEL,
    agentEffort: agentContract.AGENT_EFFORT,
    doctrine, schemas, drawAfterMs,
  });

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(regPath(hash), JSON.stringify(record, null, 2) + "\n");

  console.log(`\nRegistered.  ${hash}\n`);
  console.log(`  scenario     ${scenarioId} — ${cycles} cycles, mode ${mode}`);
  console.log(`  model        ${record.agentModel} (effort: ${record.agentEffort})`);
  console.log(`  nations      ${Object.keys(record.doctrineHashes).join(", ")}`);
  console.log(`  draw after   ${record.drawAfter}`);
  console.log(`  entropy      ${record.beaconUri}`);
  console.log(`\n  That pulse does not exist yet. Nobody, including you, can know what it will say,`);
  console.log(`  which is what makes these parameters a promise rather than a preference.\n`);
  console.log(`  Commit ${path.relative(process.cwd(), regPath(hash))} now, before drawing.\n`);
}

async function cmdDraw(argv) {
  const { record: registration, hash } = loadRegistration(argv[0] ?? "");
  const drawAfter = Date.parse(registration.drawAfter);
  if (Date.now() < drawAfter) {
    const wait = Math.ceil((drawAfter - Date.now()) / 1000);
    throw new Error(`Too early. The registered pulse lands at ${registration.drawAfter} — ${wait}s from now.`);
  }
  if (fs.existsSync(resPath(hash))) {
    throw new Error(`This registration already has a result. Registrations are single-use on purpose.`);
  }

  console.log(`Fetching the registered pulse from NIST…`);
  const beacon = await fetchBeaconAtOrAfter(drawAfter);
  console.log(`  pulse #${beacon.pulseIndex} @ ${beacon.timeStamp}`);
  console.log(`  outputValue ${beacon.outputValue.slice(0, 32)}…\n`);

  const runFile = flag(argv, "--results");
  if (!runFile) {
    console.log(`Now run the simulation for real, seeded from that pulse, then seal it:`);
    console.log(`  node scripts/prereg.js draw ${hash.slice(0, 16)} --results <run.json>\n`);
    console.log(`<run.json> is {"cycles": [...], "servedModels": [...]} — the per-cycle output and`);
    console.log(`the model id each decision actually came back from.\n`);
    return;
  }

  const run = JSON.parse(fs.readFileSync(runFile, "utf8"));
  const sealed = sealRun({
    registrationHash: hash,
    beacon,
    cycles: run.cycles,
    servedModels: run.servedModels ?? [],
  });
  fs.writeFileSync(resPath(hash), JSON.stringify(sealed.record, null, 2) + "\n");
  console.log(`Sealed.  chain ${sealed.record.chain}`);
  console.log(`  ${path.relative(process.cwd(), resPath(hash))}\n`);
  console.log(`  Publish it. Whatever it says.\n`);
}

async function cmdVerify(argv) {
  const { record: registration, hash } = loadRegistration(argv[0] ?? "");
  if (!fs.existsSync(resPath(hash))) {
    console.log(`\n  ⚠  Registration ${hash.slice(0, 16)} has NO published result.`);
    console.log(`     Registered ${registration.createdAt}, draw was due ${registration.drawAfter}.`);
    console.log(`     That is not a verification failure — it is the finding. A promised run`);
    console.log(`     that never appeared is exactly what this mechanism exists to surface.\n`);
    process.exitCode = 1;
    return;
  }
  const result = JSON.parse(fs.readFileSync(resPath(hash), "utf8"));
  const report = await verifyRun({ registration, result });

  console.log(`\nVerifying ${hash.slice(0, 16)}\n`);
  for (const c of report.checks) console.log(`  ${c.ok ? "✅" : "❌"}  ${c.name}\n      ${c.detail}`);
  console.log(`\n  ${report.ok ? "✅ all checks passed" : "❌ verification FAILED"}\n`);
  console.log(`  Proves:          ${report.proves}`);
  console.log(`  Does not prove:  ${report.doesNotProve}\n`);
  if (!report.ok) process.exitCode = 1;
}

function cmdList() {
  if (!fs.existsSync(DIR)) return console.log("No registrations yet.");
  const regs = fs.readdirSync(DIR).filter((f) => f.endsWith(".registration.json"));
  if (!regs.length) return console.log("No registrations yet.");
  console.log();
  for (const f of regs) {
    const r = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
    const h = hashRecord(r);
    const sealed = fs.existsSync(resPath(h));
    const overdue = !sealed && Date.now() > Date.parse(r.drawAfter);
    console.log(`  ${sealed ? "✅ published" : overdue ? "⚠  UNPUBLISHED" : "⏳ pending   "}  ${h.slice(0, 16)}  ${r.scenarioId}  ${r.cycles}cy  draw ${r.drawAfter}`);
  }
  console.log();
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = { register: cmdRegister, draw: cmdDraw, verify: cmdVerify, list: cmdList };
(async () => {
  if (!commands[cmd]) {
    console.log("usage: prereg <register|draw|verify|list> [args]");
    process.exitCode = 1;
    return;
  }
  await commands[cmd](rest);
})().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exitCode = 1;
});
