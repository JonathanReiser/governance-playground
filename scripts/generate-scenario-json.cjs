/**
 * Regenerates frontend/src/scenarios/*.json from the canonical
 * scenarios/*.config.cjs files.
 *
 * WHY THIS EXISTS: the frontend imports these JSON snapshots directly
 * (real JSON, not a live require of the .cjs), for Vite bundling reasons.
 * That means editing a .cjs scenario config does NOTHING to the live app
 * until this script re-runs -- confirmed the hard way (2026-08-07): the US
 * peacekeeper feature was fully built, tested, and deployed, but the US
 * nation was invisible in the live UI for one commit because this
 * regeneration step was missing, and nothing caught it (build/lint/tests
 * all passed, since they exercise agents.js directly against the .cjs
 * files, never touching the stale JSON the actual browser bundle used).
 *
 * Run this after ANY edit to scenarios/*.config.cjs, before build/deploy:
 *   node scripts/generate-scenario-json.cjs
 */

const fs = require("fs");
const path = require("path");

const SCENARIOS = [
  { cjs: "middle-east-2026.config.cjs", json: "middle-east-2026.json" },
  { cjs: "taiwan-strait-2026.config.cjs", json: "taiwan-strait-2026.json" },
];

const outDir = path.join(__dirname, "..", "frontend", "src", "scenarios");

let anyChanged = false;
for (const { cjs, json } of SCENARIOS) {
  const cjsPath = path.join(__dirname, "..", "scenarios", cjs);
  const jsonPath = path.join(outDir, json);

  delete require.cache[require.resolve(cjsPath)];
  const scenario = require(cjsPath);
  const next = JSON.stringify(scenario, null, 2);
  const prev = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, "utf8") : null;

  if (next === prev) {
    console.log(`${json}: already up to date`);
  } else {
    fs.writeFileSync(jsonPath, next);
    anyChanged = true;
    console.log(`${json}: regenerated (${scenario.nations.length} nations)`);
  }
}

if (!anyChanged) console.log("\nNothing to do — all scenario JSON already matches its .cjs source.");
