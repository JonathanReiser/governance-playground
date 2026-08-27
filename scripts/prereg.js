#!/usr/bin/env node
/**
 * scripts/prereg.js — the operator-facing half of pre-registration.
 *
 * Single run (one preregistered run, cited as a flagship result):
 *   node scripts/prereg.js register <scenarioId> [--cycles 10] [--in 15m]
 *   node scripts/prereg.js draw     <registrationHash>
 *   node scripts/prereg.js verify   <registrationHash>
 *
 * Batch (N independent trials of the same scenario + starting condition,
 * for an actual distribution instead of one run's single outcome — see
 * server/prereg.js's own header comment on why this needs a different
 * verify check than the single-run path, not just "more cycles"):
 *   node scripts/prereg.js register-batch <scenarioId> --trials 50 --cycles 5 \
 *       --hypothesis "text" [--conditions id1,id2] [--in 15m]
 *   node scripts/prereg.js draw-batch  <registrationHash>
 *   node scripts/prereg.js verify-batch <registrationHash>
 *
 *   node scripts/prereg.js list
 *
 * `register`/`register-batch` write a public promise and print its hash.
 * `draw`/`draw-batch` wait for the registered NIST pulse to exist, fetch it,
 * and seal whatever the run(s) produced against it. `verify`/`verify-batch`
 * re-derive everything a stranger could check.
 *
 * Registrations and results are written to preregistrations/ as plain JSON so
 * they can be committed to git — a registration whose result never lands is
 * supposed to stay visible in the history. That visibility is the mechanism.
 */

const fs = require("fs");
const path = require("path");
const {
  createRegistration, sealRun, verifyRun,
  createBatchRegistration, sealBatch, verifyBatch,
  fetchBeaconAtOrAfter, hashRecord,
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

async function cmdRegisterBatch(argv) {
  const scenarioId = argv[0];
  if (!scenarioId) {
    throw new Error(
      "usage: prereg register-batch <scenarioId> --trials N --cycles N --hypothesis \"text\" [--conditions id1,id2] [--in 15m]"
    );
  }
  const trialCount = Number(flag(argv, "--trials") ?? 0);
  const cyclesPerTrial = Number(flag(argv, "--cycles") ?? 0);
  const hypothesis = flag(argv, "--hypothesis");
  if (!hypothesis) throw new Error("--hypothesis is required — state what you expect before running any trial");
  const startingConditionIds = (flag(argv, "--conditions") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const delayMs = parseDuration(flag(argv, "--in") ?? "15m");
  const mode = flag(argv, "--mode") ?? "ai-quantum-tier1";

  const { agentContract } = require("../server.js");
  const doctrine = agentContract.doctrineOf(scenarioId);
  const schemas = agentContract.DECISION_SCHEMAS[scenarioId];
  if (!schemas) throw new Error(`No decision schemas registered for scenario: ${scenarioId}`);

  const drawAfterMs = Date.now() + delayMs;
  const { record, hash } = createBatchRegistration({
    scenarioId, startingConditionIds, hypothesis, trialCount, cyclesPerTrial, mode,
    agentModel: agentContract.AGENT_MODEL,
    agentEffort: agentContract.AGENT_EFFORT,
    doctrine, schemas, drawAfterMs,
  });

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(regPath(hash), JSON.stringify(record, null, 2) + "\n");

  console.log(`\nRegistered batch.  ${hash}\n`);
  console.log(`  scenario     ${scenarioId}${startingConditionIds.length ? ` — ${startingConditionIds.join(", ")}` : " — as researched (default)"}`);
  console.log(`  hypothesis   ${hypothesis}`);
  console.log(`  trials       ${trialCount} × ${cyclesPerTrial} cycles each`);
  console.log(`  model        ${record.agentModel} (effort: ${record.agentEffort})`);
  console.log(`  draw after   ${record.drawAfter}`);
  console.log(`  entropy      ${record.beaconUri}`);
  console.log(`\n  That pulse does not exist yet. Nobody, including you, can know what it will say,`);
  console.log(`  which is what makes this hypothesis and trial count a promise, not a preference.\n`);
  console.log(`  Commit ${path.relative(process.cwd(), regPath(hash))} now, before running any trial.\n`);
}

async function cmdDrawBatch(argv) {
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
    console.log(`Now run all ${registration.trialCount} trials for real, then seal every one of them:`);
    console.log(`  node scripts/prereg.js draw-batch ${hash.slice(0, 16)} --results <batch.json>\n`);
    console.log(`<batch.json> is {"trials": [{"trialIndex": 0, "cycles": [...]}, ...], "servedModels": [...]}`);
    console.log(`— every registered trial's per-cycle output, not a selection of them.\n`);
    return;
  }

  const batch = JSON.parse(fs.readFileSync(runFile, "utf8"));
  if (batch.trials.length !== registration.trialCount) {
    console.log(`\n  ⚠  ${batch.trials.length} trials in ${runFile}, but ${registration.trialCount} were registered.`);
    console.log(`     Sealing anyway — verify-batch will flag this mismatch as a public fact rather than`);
    console.log(`     silently accept a shrunk batch, but this is your last chance to add the missing trials first.\n`);
  }
  const sealed = sealBatch({
    registrationHash: hash,
    beacon,
    trials: batch.trials,
    servedModels: batch.servedModels ?? [],
  });
  fs.writeFileSync(resPath(hash), JSON.stringify(sealed.record, null, 2) + "\n");
  console.log(`Sealed.  chain ${sealed.record.chain}`);
  console.log(`  ${path.relative(process.cwd(), resPath(hash))}\n`);
  console.log(`  Publish it. Whatever it says.\n`);
}

async function cmdVerifyBatch(argv) {
  const { record: registration, hash } = loadRegistration(argv[0] ?? "");
  if (!fs.existsSync(resPath(hash))) {
    console.log(`\n  ⚠  Registration ${hash.slice(0, 16)} has NO published result.`);
    console.log(`     Registered ${registration.createdAt}, draw was due ${registration.drawAfter}.`);
    console.log(`     That is not a verification failure — it is the finding. A promised batch`);
    console.log(`     that never appeared is exactly what this mechanism exists to surface.\n`);
    process.exitCode = 1;
    return;
  }
  const result = JSON.parse(fs.readFileSync(resPath(hash), "utf8"));
  const report = await verifyBatch({ registration, result });

  console.log(`\nVerifying batch ${hash.slice(0, 16)}\n`);
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
    const status = sealed ? "✅ published" : overdue ? "⚠  UNPUBLISHED" : "⏳ pending   ";
    const size = r.kind === "governance-playground/batch-preregistration" ? `${r.trialCount}tr×${r.cyclesPerTrial}cy` : `${r.cycles}cy`;
    console.log(`  ${status}  ${h.slice(0, 16)}  ${r.scenarioId}  ${size}  draw ${r.drawAfter}`);
  }
  console.log();
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  register: cmdRegister, draw: cmdDraw, verify: cmdVerify,
  "register-batch": cmdRegisterBatch, "draw-batch": cmdDrawBatch, "verify-batch": cmdVerifyBatch,
  list: cmdList,
};
(async () => {
  if (!commands[cmd]) {
    console.log("usage: prereg <register|draw|verify|register-batch|draw-batch|verify-batch|list> [args]");
    process.exitCode = 1;
    return;
  }
  await commands[cmd](rest);
})().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exitCode = 1;
});
