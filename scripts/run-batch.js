#!/usr/bin/env node
/**
 * scripts/run-batch.js — actually runs the N trials a batch registration
 * declared, and writes the batch.json that `node scripts/prereg.js
 * draw-batch <hash> --results batch.json` seals against real NIST entropy.
 *
 * Deliberately a separate step from draw-batch, same split the single-run
 * path already has (draw expects a pre-built run.json; something else has
 * to produce it — for a single run that's a real browser session, for a
 * batch it's this script): fetching entropy and running N real trials are
 * different concerns, and keeping them apart means a batch that fails
 * partway through generation doesn't touch the entropy/sealing step at all.
 *
 * Every trial runs the EXACT SAME pipeline a live visitor's browser does —
 * frontend/src/lib/cycleRunner.js's runAutonomousCycle(), dynamically
 * imported here since it's an ES module and this script is CommonJS (same
 * split server.js/prereg.js already live with) — with one difference: the
 * nation-decision call goes straight to server.js's own decideNationAction
 * (also exported for exactly this) instead of a fetch() to a running
 * server. No live HTTP server needed to generate a batch.
 *
 *   node scripts/run-batch.js <registrationHash> [--out preregistrations/<hash>.batch.json]
 *
 * Requires ANTHROPIC_API_KEY — every trial is a real run, not a fixture:
 * real Claude decisions, real quantum collapse (Tier 1, real entropy),
 * real market resolution, exactly as costly as running that many cycles
 * any other way. See README's cost section before running a large trial
 * count.
 */

const fs = require("fs");
const path = require("path");
const { applyStartingConditionOverrides } = require("../server/scenarioOverrides");

const DIR = path.join(__dirname, "..", "preregistrations");
const SCENARIO_FILE = (id) => path.join(__dirname, "..", "frontend", "src", "scenarios", `${id}.json`);

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function loadRegistrationByHash(hashPrefix) {
  const file = fs.readdirSync(DIR).find((f) => f.startsWith(hashPrefix.slice(0, 16)) && f.endsWith(".registration.json"));
  if (!file) throw new Error(`No registration found matching ${hashPrefix}`);
  return JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
}

/**
 * One trial: fresh sim state and agent memory (see LiveRunPanel.jsx's own
 * fresh-run initialization — this mirrors it exactly, not a re-derivation),
 * cyclesPerTrial cycles run straight through with no human in the loop.
 */
async function runOneTrial({ trialIndex, scenario, cyclesPerTrial, decideFn, runAutonomousCycle, initSimState, initQuantumBeliefs, initMarketBeliefs }) {
  let simState = initSimState(scenario);
  let agentMemory = { quantum: initQuantumBeliefs(scenario), markets: initMarketBeliefs(scenario) };
  const cycles = [];
  const servedModels = [];

  for (let cycle = 1; cycle <= cyclesPerTrial; cycle++) {
    const { decisions, committed, quantum, market, newAgentMemory } =
      await runAutonomousCycle(scenario, simState, cycle, agentMemory, decideFn);

    for (const d of Object.values(decisions)) if (d?.model) servedModels.push(d.model);

    cycles.push({ cycle, committed, decisions, quantum, market });
    simState = committed;
    agentMemory = newAgentMemory;
  }

  return { trialIndex, cycles, servedModels };
}

async function main() {
  const hashArg = process.argv[2];
  if (!hashArg) throw new Error("usage: run-batch <registrationHash> [--out path.json]");
  const argv = process.argv.slice(3);

  const registration = loadRegistrationByHash(hashArg);
  if (registration.kind !== "governance-playground/batch-preregistration") {
    throw new Error(`${hashArg} is not a batch registration (kind: ${registration.kind})`);
  }
  const { scenarioId, startingConditionIds, trialCount, cyclesPerTrial, hypothesis } = registration;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — every trial makes real Claude calls, same as any live run");
  }

  console.log(`\nRunning batch for ${hashArg}`);
  console.log(`  scenario     ${scenarioId}${startingConditionIds.length ? ` — ${startingConditionIds.join(", ")}` : " — as researched (default)"}`);
  console.log(`  hypothesis   ${hypothesis}`);
  console.log(`  trials       ${trialCount} × ${cyclesPerTrial} cycles each\n`);

  const rawScenario = JSON.parse(fs.readFileSync(SCENARIO_FILE(scenarioId), "utf8"));
  const scenario = applyStartingConditionOverrides(rawScenario, startingConditionIds);

  // ESM modules, dynamically imported into this CommonJS script — same
  // split server.js takes with prereg.js's own require() of it.
  const { runAutonomousCycle, initSimState } = await import("../frontend/src/lib/cycleRunner.js");
  const { initQuantumBeliefs, initMarketBeliefs } = await import("../frontend/src/lib/agents.js");
  const { agentContract } = require("../server.js");

  const trials = [];
  const allServedModels = new Set();
  for (let i = 0; i < trialCount; i++) {
    process.stdout.write(`  trial ${i + 1} of ${trialCount}...`);
    const start = Date.now();
    const trial = await runOneTrial({
      trialIndex: i, scenario, cyclesPerTrial,
      decideFn: agentContract.decideNationAction,
      runAutonomousCycle, initSimState, initQuantumBeliefs, initMarketBeliefs,
    });
    for (const m of trial.servedModels) allServedModels.add(m);
    trials.push({ trialIndex: trial.trialIndex, cycles: trial.cycles });
    console.log(` done (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  }

  const outPath = flag(argv, "--out") ?? path.join(DIR, `${hashArg.slice(0, 16)}.batch.json`);
  fs.writeFileSync(outPath, JSON.stringify({ trials, servedModels: [...allServedModels] }, null, 2) + "\n");

  console.log(`\nWrote ${path.relative(process.cwd(), outPath)}`);
  console.log(`  node scripts/prereg.js draw-batch ${hashArg.slice(0, 16)} --results ${path.relative(process.cwd(), outPath)}\n`);
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exitCode = 1;
});
