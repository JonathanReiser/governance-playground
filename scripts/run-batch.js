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

  // HARD FAIL on an unknown starting-condition id, before spending anything.
  //
  // applyStartingConditionOverrides() deliberately no-ops on an id it can't
  // find, so a stale menu entry never throws in the browser. That's right for
  // the UI and wrong here: a preregistered batch that silently runs at plain
  // baseline still produces complete, publishable-looking output, and the
  // only way to notice is to diff its cycle-1 metrics against the baseline
  // arm afterwards. That is exactly what happened on 2026-09-02 to
  // registration 700254f5 — the three new conditions had been added to
  // scenarios/*.config.cjs but scripts/generate-scenario-json.cjs had not
  // been re-run, so the id resolved to nothing here and $2.95 of real Claude
  // calls tested the baseline while claiming to test a condition.
  //
  // Note this reads the GENERATED json, not the .cjs — that gap is the bug,
  // so the check has to live on this side of it.
  const knownConditionIds = new Set((rawScenario.startingConditionProposals || []).map((p) => p.id));
  const unknownIds = startingConditionIds.filter((id) => !knownConditionIds.has(id));
  if (unknownIds.length) {
    throw new Error(
      `starting condition(s) not found in ${SCENARIO_FILE(scenarioId)}: ${unknownIds.join(", ")}\n` +
      `  known ids: ${[...knownConditionIds].join(", ")}\n` +
      `  If you just edited scenarios/${scenarioId}.config.cjs, run:\n` +
      `      node scripts/generate-scenario-json.cjs\n` +
      `  Refusing to run — this batch would have silently executed at baseline.`
    );
  }

  const scenario = applyStartingConditionOverrides(rawScenario, startingConditionIds);

  // Hard-fail if the overrides changed literally nothing (e.g. `overrides: null`).
  // as_researched is legitimately a no-op, so it's exempt.
  const substantive = startingConditionIds.filter((id) => id !== "as_researched");
  if (substantive.length && JSON.stringify(scenario) === JSON.stringify(rawScenario)) {
    throw new Error(
      `starting condition(s) ${substantive.join(", ")} resolved but changed nothing in the scenario.\n` +
      `  Refusing to run — this batch would have silently executed at baseline.`
    );
  }

  // WARN on override paths that don't already exist in the scenario.
  //
  // The check above is necessary but not sufficient, and it's worth being
  // precise about why: writing to a path nothing reads still MUTATES the
  // object, so the deep-equal test passes while the override does nothing.
  // That is a real bug that shipped — mou_deal_concluded originally set
  // Israel's sentiment at nations.israel.governance.publicSentiment, which
  // no code reads; agents.js:319 sources it from population.sentiment. The
  // deep-equal check would not have caught it.
  //
  // A pre-existing path is the signal: legitimate overrides adjust fields
  // the scenario already defines. This is a WARNING and not an error
  // because eisenkot_wins_election deliberately writes both the live path
  // and the inert one, and that condition backs published batch 853a7c92 —
  // making this fatal would break a reproducible published result.
  const missingPaths = [];
  const walkOverride = (node, target, trail) => {
    for (const [key, value] of Object.entries(node || {})) {
      const here = [...trail, key];
      const nextTarget = target === undefined ? undefined : target?.[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        walkOverride(value, nextTarget, here);
      } else if (nextTarget === undefined) {
        missingPaths.push(here.join("."));
      }
    }
  };
  for (const id of substantive) {
    const proposal = (rawScenario.startingConditionProposals || []).find((p) => p.id === id);
    const nationsOverride = proposal?.overrides?.nations || {};
    for (const [nationId, patch] of Object.entries(nationsOverride)) {
      const nation = (rawScenario.nations || []).find((n) => n.id === nationId);
      if (!nation) { missingPaths.push(`nations.${nationId}`); continue; }
      walkOverride(patch, nation, ["nations", nationId]);
    }
    const metricIds = new Set((rawScenario.simulation?.metrics || []).map((m) => m.id));
    for (const metricId of Object.keys(proposal?.overrides?.metrics || {})) {
      if (!metricIds.has(metricId)) missingPaths.push(`metrics.${metricId}`);
    }
  }
  if (missingPaths.length) {
    console.warn(
      `\n  WARNING: override path(s) not present in the scenario — these set fields nothing may read:\n` +
      missingPaths.map((x) => `    ${x}`).join("\n") +
      `\n  Verify against the scenario schema before trusting this run.\n`
    );
  }

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
