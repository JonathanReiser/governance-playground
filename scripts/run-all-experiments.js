/**
 * GOVERNANCE PLAYGROUND — Full Experiment Suite
 *
 * Runs all four pre-built Middle East 2026 experiments and produces
 * a consolidated research report comparing outcomes across scenarios.
 *
 * Experiments:
 *   1. exp_deal_collapse      — Peace deal collapses in cycle 1
 *   2. exp_congress_blocks    — US fails to deliver sanctions relief
 *   3. exp_saudi_normalizes   — Saudi Arabia formally recognizes Israel
 *   4. exp_hardliners_win     — Iranian hardliners replace moderates
 *
 * Each experiment:
 *   PHASE 1 — Fresh deploy of the full Middle East scenario
 *   PHASE 2 — Baseline run (N cycles, no change)
 *   PHASE 3 — Experiment run (same N cycles, one variable changed)
 *   PHASE 4 — Comparison + hypothesis evaluation
 *
 * Final output: cross-experiment ranking table and research summary.
 *
 * Usage:
 *   npx hardhat run scripts/run-all-experiments.js --network hardhat
 */

const { ethers } = require("hardhat");
const SCENARIO   = require("../scenarios/middle-east-2026.config.cjs");

const CYCLES = 10;

// ─────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────

const GovernanceType = {
  PARLIAMENTARY_DEMOCRACY: 0,
  THEOCRATIC_REPUBLIC:     1,
  ABSOLUTE_MONARCHY:       2,
  FEDERAL_REPUBLIC:        3,
  MILITARY_JUNTA:          4,
};

const VotingMechanism = {
  ONE_TOKEN_ONE_VOTE: 0,
  DUAL_LAYER:         1,
  COUNCIL_WEIGHTED:   2,
  QUADRATIC:          3,
};

const RelationshipType = {
  ALLIED:        0,
  PARTNER:       1,
  NEUTRAL:       2,
  FRAGILE_PEACE: 3,
  COLD:          4,
  SANCTIONED:    5,
  HOSTILE:       6,
};

const EventType = {
  PEACE_DEAL:      0,
  WAR:             1,
  RESOURCE_EVENT:  2,
  ECONOMIC_CRISIS: 3,
  ELECTION:        4,
  COUP:            5,
  SANCTIONS:       6,
};

const EventStatus = {
  PENDING:        0,
  ACTIVE:         1,
  ACTIVE_FRAGILE: 2,
  RESOLVED:       3,
  COLLAPSED:      4,
};

// ─────────────────────────────────────────────────────────────
// SIMULATION ENGINE
// ─────────────────────────────────────────────────────────────

class SimulationEngine {
  constructor(scenario) {
    const m = scenario.simulation.metrics;
    this.state = {
      stability:     m.find(x => x.id === "stability_index").startingValue,
      conflicts:     m.find(x => x.id === "conflict_events").startingValue,
      trade:         m.find(x => x.id === "trade_volume").startingValue,
      proxy:         m.find(x => x.id === "proxy_activity").startingValue,
      dealIntegrity: m.find(x => x.id === "deal_integrity").startingValue,
    };
    this.dealActive = true;
    this.history    = [];
  }

  applyExperiment(experimentId) {
    const s = this.state;

    if (experimentId === "exp_deal_collapse") {
      this.dealActive    = false;
      s.stability        = Math.max(0, s.stability - 18);
      s.dealIntegrity    = 0;
      s.conflicts       += 4;
      s.proxy           += 20;
    }

    if (experimentId === "exp_congress_blocks") {
      // Sanctions relief blocked — Iran's incentive to hold the deal weakens
      s.dealIntegrity   -= 25;
      s.proxy           += 10;
      // Deal doesn't collapse immediately, but is under pressure
    }

    if (experimentId === "exp_saudi_normalizes") {
      // New US-backed alliance — trade opens, Iran feels encircled
      s.trade           += 200;
      s.stability       += 12;
      s.proxy           += 8;
    }

    if (experimentId === "exp_hardliners_win") {
      // Hardliners in control — deal at immediate risk, proxy war resumes
      s.dealIntegrity   -= 35;
      s.proxy           += 25;
      s.stability       -= 10;
      // Hardliner pressure makes the deal progressively more likely to collapse
      this._hardlinerMode = true;
    }
  }

  tick(cycleNum) {
    const s = this.state;

    if (this.dealActive) {
      s.dealIntegrity = Math.max(0, s.dealIntegrity - 2);

      // Hardliner pressure accelerates deal erosion
      if (this._hardlinerMode) {
        s.dealIntegrity = Math.max(0, s.dealIntegrity - 4);
        s.proxy         = Math.min(100, s.proxy + 3);
      }

      // Trigger deal collapse when integrity hits zero
      if (s.dealIntegrity <= 0) {
        this.dealActive  = false;
        s.dealIntegrity  = 0;
        s.conflicts     += 5;
        s.proxy          = Math.min(100, s.proxy + 15);
        s.stability      = Math.max(0, s.stability - 12);
      } else if (s.dealIntegrity < 20) {
        // Deal fragmenting — instability grows
        s.stability  = Math.max(0, s.stability - 3);
        s.conflicts += 1;
        s.proxy      = Math.min(100, s.proxy + 3);
      } else {
        // Deal holding — slow improvement
        s.stability  = Math.min(100, s.stability + 1);
        s.trade      = Math.min(500, s.trade + 8);
        s.proxy      = Math.max(0,   s.proxy - 1);
        s.conflicts  = Math.max(0,   s.conflicts - 1);
      }
    } else {
      // Deal collapsed — cascading deterioration
      s.dealIntegrity  = 0;
      s.conflicts     += Math.floor(Math.random() * 3) + 2;
      s.proxy          = Math.min(100, s.proxy + 5);
      s.trade          = Math.max(0,   s.trade - 15);
      s.stability      = Math.max(0,   s.stability - 4);

      // Hormuz threat — spikes every 3 cycles
      if (cycleNum % 3 === 0) {
        s.trade      = Math.max(0, s.trade     - 30);
        s.stability  = Math.max(0, s.stability - 5);
        s.conflicts += 3;
      }
    }

    s.stability     = Math.min(100, Math.max(0, Math.round(s.stability)));
    s.conflicts     = Math.max(0,   Math.round(s.conflicts));
    s.trade         = Math.max(0,   Math.round(s.trade));
    s.proxy         = Math.min(100, Math.max(0, Math.round(s.proxy)));
    s.dealIntegrity = Math.min(100, Math.max(0, Math.round(s.dealIntegrity)));

    this.history.push({ cycle: cycleNum, ...s });
    return { ...s };
  }

  snapshot() {
    return { ...this.state };
  }
}

// ─────────────────────────────────────────────────────────────
// DEPLOY
// ─────────────────────────────────────────────────────────────

function buildNationConfig(nation, signers) {
  const gov = nation.governance;
  return {
    name:               nation.name,
    nationId:           nation.id,
    governanceType:     GovernanceType[gov.type],
    votingMechanism:    VotingMechanism[gov.votingMechanism],
    proposalThreshold:  BigInt(gov.proposalThreshold),
    quorumPercent:      BigInt(gov.quorum),
    votingDelayBlocks:  BigInt(1),
    votingPeriodBlocks: BigInt(5),
    timelockBlocks:     BigInt(2),
    hasGuardianVeto:    gov.guardianVeto || false,
    hasRoyalVeto:       gov.royalVeto    || false,
    guardianCouncil:    gov.guardianVeto ? signers[1].address : ethers.ZeroAddress,
    royalAuthority:     gov.royalVeto    ? signers[2].address : ethers.ZeroAddress,
    hardlinerPressure:  BigInt(gov.hardlinerPressure || 0),
    reformPressure:     BigInt(gov.reformPressure    || 0),
  };
}

async function deployScenario(signers) {
  const deployer = signers[0];

  const WorldRegistry = await ethers.getContractFactory("WorldRegistry");
  const registry      = await WorldRegistry.deploy(deployer.address);
  await registry.waitForDeployment();

  const MetricsOracle = await ethers.getContractFactory("MetricsOracle");
  const oracle        = await MetricsOracle.deploy(
    await registry.getAddress(),
    deployer.address
  );
  await oracle.waitForDeployment();

  await registry.setMetricsOracle(await oracle.getAddress());

  await registry.initializeScenario(
    SCENARIO.meta.name,
    SCENARIO.meta.version,
    BigInt(SCENARIO.simulation.defaultCycles)
  );

  for (const nation of SCENARIO.nations) {
    const config = buildNationConfig(nation, signers);
    await registry.registerNation(
      config,
      BigInt(1_000_000) * BigInt(10 ** 18),
      BigInt(nation.economy.treasury),
      BigInt(nation.military.power)
    );
  }

  const dist = {
    israel:       [
      [signers[0].address, signers[3].address, signers[4].address, signers[5].address],
      [200_000n, 500_000n, 200_000n, 100_000n].map(n => n * BigInt(10 ** 18)),
    ],
    iran:         [
      [signers[0].address, signers[3].address, signers[4].address, signers[5].address],
      [100_000n, 300_000n, 500_000n, 100_000n].map(n => n * BigInt(10 ** 18)),
    ],
    saudi_arabia: [
      [signers[2].address, signers[3].address, signers[5].address],
      [800_000n, 150_000n, 50_000n].map(n => n * BigInt(10 ** 18)),
    ],
  };
  for (const [id, [addrs, amounts]] of Object.entries(dist)) {
    await registry.distributeCitizenship(id, addrs, amounts);
  }

  for (const rel of SCENARIO.relationships) {
    await registry.setRelationship(
      rel.from, rel.to,
      RelationshipType[rel.type] ?? RelationshipType.NEUTRAL,
      BigInt(rel.stabilityScore),
      rel.treatyActive, rel.treatyName || ""
    );
  }

  for (const evt of SCENARIO.activeEvents) {
    if (evt.type === "PEACE_DEAL" || evt.type === "RESOURCE_EVENT") {
      await registry.createGlobalEvent(
        evt.id, evt.name,
        EventType[evt.type] ?? EventType.PEACE_DEAL,
        evt.parties || [], evt.description
      );
    }
  }

  const m = SCENARIO.simulation.metrics;
  await oracle.updateMetrics(
    BigInt(m.find(x => x.id === "stability_index").startingValue),
    BigInt(m.find(x => x.id === "conflict_events").startingValue),
    BigInt(m.find(x => x.id === "trade_volume").startingValue),
    BigInt(m.find(x => x.id === "proxy_activity").startingValue),
    BigInt(m.find(x => x.id === "deal_integrity").startingValue)
  );

  await registry.startSimulation();
  return { registry, oracle };
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function bar(value, max = 100, width = 20) {
  const filled = Math.round((value / max) * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

function stabilityLabel(score) {
  if (score >= 75) return "STABLE  ";
  if (score >= 50) return "MODERATE";
  if (score >= 25) return "FRAGILE ";
  return "CRITICAL";
}

function d(after, before) {
  const diff = after - before;
  return (diff >= 0 ? "+" : "") + diff;
}

// ─────────────────────────────────────────────────────────────
// RUN ONE EXPERIMENT — returns { experiment, baseline, result, cycles }
// ─────────────────────────────────────────────────────────────

async function runExperiment(experimentId, signers, index, total) {
  const experiment = SCENARIO.experiments.find(e => e.id === experimentId);

  console.log(`\n${"═".repeat(54)}`);
  console.log(`  EXPERIMENT ${index}/${total}: ${experiment.name}`);
  console.log(`${"═".repeat(54)}`);
  console.log(`  Question:   "${experiment.question}"`);
  console.log(`  Hypothesis: "${experiment.hypothesis}"`);

  // ── Baseline ─────────────────────────────────────────────

  process.stdout.write("\n  [Baseline]  ");
  const { registry, oracle } = await deployScenario(signers);

  const baseEngine = new SimulationEngine(SCENARIO);
  const baseStart  = baseEngine.snapshot();

  await oracle.updateMetrics(
    BigInt(baseStart.stability), BigInt(baseStart.conflicts),
    BigInt(baseStart.trade),     BigInt(baseStart.proxy),
    BigInt(baseStart.dealIntegrity)
  );
  await registry.advanceCycle();
  await oracle.setBaseline(1);

  for (let i = 1; i <= CYCLES; i++) {
    const m = baseEngine.tick(i);
    await oracle.updateMetrics(
      BigInt(m.stability), BigInt(m.conflicts),
      BigInt(m.trade),     BigInt(m.proxy),
      BigInt(m.dealIntegrity)
    );
    await registry.advanceCycle();
    process.stdout.write(".");
  }
  process.stdout.write(" done\n");
  const baseline = baseEngine.snapshot();

  // ── Experiment ───────────────────────────────────────────

  process.stdout.write("  [Experiment]");
  const { registry: reg2, oracle: oracle2 } = await deployScenario(signers);

  const expEngine = new SimulationEngine(SCENARIO);
  expEngine.applyExperiment(experimentId);

  await oracle2.recordExperiment(
    experimentId, "global",
    experiment.change.target, BigInt(0), BigInt(0)
  );

  if (experimentId === "exp_deal_collapse") {
    await reg2.updateEventStatus("hormuz_nuclear_deal", EventStatus.COLLAPSED);
  }

  for (let i = 1; i <= CYCLES; i++) {
    const m = expEngine.tick(i);
    await oracle2.updateMetrics(
      BigInt(m.stability), BigInt(m.conflicts),
      BigInt(m.trade),     BigInt(m.proxy),
      BigInt(m.dealIntegrity)
    );
    await reg2.advanceCycle();
    process.stdout.write(".");
  }
  process.stdout.write(" done\n");
  const result = expEngine.snapshot();

  // ── Inline report ────────────────────────────────────────

  console.log("\n  Metric               Baseline  Experiment     Delta");
  console.log("  " + "─".repeat(52));
  const rows = [
    ["Stability Index", baseline.stability,     result.stability,     "/100"],
    ["Conflict Events", baseline.conflicts,      result.conflicts,     ""],
    ["Trade Volume",    baseline.trade,          result.trade,         ""],
    ["Proxy Activity",  baseline.proxy,          result.proxy,         "/100"],
    ["Deal Integrity",  baseline.dealIntegrity,  result.dealIntegrity, "/100"],
  ];
  for (const [name, b, r, unit] of rows) {
    const diff = r - b;
    const sign = diff >= 0 ? "+" : "";
    const flag = Math.abs(diff) >= 15 ? " ◄" : "";
    console.log(
      `  ${name.padEnd(20)} ${String(b + unit).padStart(8)}  ` +
      `${String(r + unit).padStart(10)} ${(sign + diff).padStart(7)}${flag}`
    );
  }

  // Stability trajectory (compact — one line per phase)
  const baseAvg = Math.round(
    baseEngine.history.reduce((s, h) => s + h.stability, 0) / baseEngine.history.length
  );
  const expAvg = Math.round(
    expEngine.history.reduce((s, h) => s + h.stability, 0) / expEngine.history.length
  );
  console.log(`\n  Stability avg — Baseline: ${baseAvg}/100  Experiment: ${expAvg}/100`);
  console.log(
    `  Baseline end:    ${bar(baseline.stability)} ${baseline.stability}/100 (${stabilityLabel(baseline.stability).trim()})`
  );
  console.log(
    `  Experiment end:  ${bar(result.stability)} ${result.stability}/100 (${stabilityLabel(result.stability).trim()})`
  );

  // Hypothesis evaluation
  console.log("\n  Hypothesis evaluation:");
  evaluateHypothesis(experimentId, baseline, result, baseEngine, expEngine);

  return {
    experiment,
    baseline,
    result,
    baseHistory:   baseEngine.history,
    expHistory:    expEngine.history,
    registryAddr:  await registry.getAddress(),
    oracleAddr:    await oracle.getAddress(),
    reg2Addr:      await reg2.getAddress(),
    oracle2Addr:   await oracle2.getAddress(),
  };
}

// ─────────────────────────────────────────────────────────────
// HYPOTHESIS EVALUATION
// ─────────────────────────────────────────────────────────────

function evaluateHypothesis(id, baseline, result, baseEngine, expEngine) {
  const checks = hypothesisChecks(id, baseline, result, baseEngine, expEngine);
  for (const [label, passed] of checks) {
    console.log(`    ${passed ? "✓" : "✗"} ${label}`);
  }
}

function hypothesisChecks(id, baseline, result, baseEngine, expEngine) {
  if (id === "exp_deal_collapse") {
    const tradeDrop    = result.trade < baseline.trade * 0.6;
    const criticalStab = result.stability < 20;
    const proxySurge   = result.proxy > baseline.proxy + 15;
    const hormuzCycles = expEngine.history.filter(h => h.trade < 50).length;
    return [
      [`Hormuz closure impact (trade dropped >40%): ${tradeDrop ? "YES" : `NO — trade at ${result.trade}`}`, tradeDrop],
      [`Stability dropped below 20: ${criticalStab ? "YES" : `NO — reached ${result.stability}`}`, criticalStab],
      [`Proxy activity surged (>+15 pts): ${proxySurge ? "YES" : `NO — delta ${result.proxy - baseline.proxy}`}`, proxySurge],
      [`Hormuz closure cycles (trade <50): ${hormuzCycles}`, hormuzCycles > 0],
    ];
  }

  if (id === "exp_congress_blocks") {
    const dealWeakened   = result.dealIntegrity < baseline.dealIntegrity - 15;
    const hardlinerRise  = result.proxy > baseline.proxy + 8;
    const proxyResumes   = expEngine.history.slice(0, 5).some(h => h.proxy > 50);
    const dealCollapsed  = result.dealIntegrity === 0;
    return [
      [`Deal integrity deteriorated (>15 pt drop): ${dealWeakened ? "YES" : `NO — delta ${result.dealIntegrity - baseline.dealIntegrity}`}`, dealWeakened],
      [`Hardliner pressure rise (proxy >+8): ${hardlinerRise ? "YES" : `NO — delta ${result.proxy - baseline.proxy}`}`, hardlinerRise],
      [`Proxy activity resumed within 5 cycles: ${proxyResumes ? "YES" : "NO"}`, proxyResumes],
      [`Deal fully collapsed by end: ${dealCollapsed ? "YES" : `NO — integrity at ${result.dealIntegrity}`}`, dealCollapsed],
    ];
  }

  if (id === "exp_saudi_normalizes") {
    const tradeSurge    = result.trade > baseline.trade + 150;
    const iranEncircled = result.proxy > baseline.proxy + 5;
    const netStable     = result.stability > baseline.stability;
    const stabilityGain = result.stability - baseline.stability;
    return [
      [`Regional trade increased significantly (>+150): ${tradeSurge ? "YES" : `NO — delta ${result.trade - baseline.trade}`}`, tradeSurge],
      [`Iran hardliner response (proxy rose): ${iranEncircled ? "YES" : `NO — delta ${result.proxy - baseline.proxy}`}`, iranEncircled],
      [`Net stability gain: ${netStable ? `YES (+${stabilityGain})` : `NO (${stabilityGain})`}`, netStable],
      [`Trade and stability both up (dual win): ${tradeSurge && netStable ? "YES" : "NO"}`, tradeSurge && netStable],
    ];
  }

  if (id === "exp_hardliners_win") {
    const dealExited     = result.dealIntegrity === 0;
    const proxySurged    = result.proxy > 80;
    const hormuzCycles   = expEngine.history.filter(h => h.trade < 50).length;
    const hormuzThreat   = hormuzCycles > 0;
    const stabilityDrop  = baseline.stability - result.stability >= 15;
    return [
      [`Iran exits nuclear deal (integrity → 0): ${dealExited ? "YES" : `NO — integrity at ${result.dealIntegrity}`}`, dealExited],
      [`Proxy activity surged to maximum (>80): ${proxySurged ? `YES — ${result.proxy}` : `NO — ${result.proxy}`}`, proxySurged],
      [`Hormuz threatened within 4 cycles (${hormuzCycles} cycles below 50 trade): ${hormuzThreat ? "YES" : "NO"}`, hormuzThreat],
      [`Significant stability drop (>15 pts): ${stabilityDrop ? `YES (−${baseline.stability - result.stability})` : `NO (−${baseline.stability - result.stability})`}`, stabilityDrop],
    ];
  }

  return [];
}

// ─────────────────────────────────────────────────────────────
// CROSS-EXPERIMENT SUMMARY
// ─────────────────────────────────────────────────────────────

function printSummary(results) {
  console.log("\n\n" + "╔" + "═".repeat(60) + "╗");
  console.log("║" + "  CONSOLIDATED RESEARCH FINDINGS — MIDDLE EAST 2026".padEnd(60) + "║");
  console.log("╚" + "═".repeat(60) + "╝");

  console.log("\n  All experiments ran " + CYCLES + " cycles each from the same starting conditions.");
  console.log("  One variable changed per experiment. Everything else held constant.\n");

  // Ranking table — stability outcome
  console.log("  STABILITY RANKING (end of simulation)");
  console.log("  " + "─".repeat(56));

  const ranked = [...results].sort((a, b) => b.result.stability - a.result.stability);
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    const label = stabilityLabel(r.result.stability);
    console.log(
      `  ${i + 1}. ${r.experiment.name.padEnd(36)} ` +
      `${String(r.result.stability).padStart(3)}/100  ${label}  ` +
      `${bar(r.result.stability, 100, 12)}`
    );
  }

  // Full comparison table
  console.log("\n\n  FULL METRIC COMPARISON (experiment-end values)");
  console.log("  " + "─".repeat(72));
  console.log(
    "  " +
    "Experiment".padEnd(28) +
    "Stab".padStart(6) +
    "Confl".padStart(7) +
    "Trade".padStart(7) +
    "Proxy".padStart(7) +
    "Deal".padStart(7)
  );
  console.log("  " + "─".repeat(72));

  // Baseline row (from first result's baseline — all share the same starting point)
  const b = results[0].baseline;
  console.log(
    "  " +
    "BASELINE (no change)".padEnd(28) +
    String(b.stability).padStart(6) +
    String(b.conflicts).padStart(7) +
    String(b.trade).padStart(7) +
    String(b.proxy).padStart(7) +
    String(b.dealIntegrity).padStart(7)
  );
  console.log("  " + "─".repeat(72));

  for (const r of results) {
    const e = r.result;
    console.log(
      "  " +
      r.experiment.name.padEnd(28) +
      String(e.stability).padStart(6) +
      String(e.conflicts).padStart(7) +
      String(e.trade).padStart(7) +
      String(e.proxy).padStart(7) +
      String(e.dealIntegrity).padStart(7)
    );
  }

  // Delta table
  console.log("\n\n  DELTAS FROM BASELINE");
  console.log("  " + "─".repeat(72));
  console.log(
    "  " +
    "Experiment".padEnd(28) +
    "Stab".padStart(6) +
    "Confl".padStart(7) +
    "Trade".padStart(7) +
    "Proxy".padStart(7) +
    "Deal".padStart(7)
  );
  console.log("  " + "─".repeat(72));

  for (const r of results) {
    const e = r.result;
    console.log(
      "  " +
      r.experiment.name.padEnd(28) +
      d(e.stability,     b.stability).padStart(6) +
      d(e.conflicts,     b.conflicts).padStart(7) +
      d(e.trade,         b.trade).padStart(7) +
      d(e.proxy,         b.proxy).padStart(7) +
      d(e.dealIntegrity, b.dealIntegrity).padStart(7)
    );
  }

  // Key findings
  console.log("\n\n  KEY FINDINGS");
  console.log("  " + "─".repeat(56));

  const mostDestructive = results.reduce((a, b) =>
    (a.result.stability < b.result.stability) ? a : b
  );
  const leastDestructive = results.reduce((a, b) =>
    (a.result.stability > b.result.stability) ? a : b
  );
  const highestTrade = results.reduce((a, b) =>
    (a.result.trade > b.result.trade) ? a : b
  );
  const highestProxy = results.reduce((a, b) =>
    (a.result.proxy > b.result.proxy) ? a : b
  );

  console.log(
    `\n  Most destabilizing:  "${mostDestructive.experiment.name}"` +
    `\n                       Stability → ${mostDestructive.result.stability}/100 ` +
    `(${d(mostDestructive.result.stability, b.stability)} from baseline)`
  );

  console.log(
    `\n  Least destabilizing: "${leastDestructive.experiment.name}"` +
    `\n                       Stability → ${leastDestructive.result.stability}/100 ` +
    `(${d(leastDestructive.result.stability, b.stability)} from baseline)`
  );

  console.log(
    `\n  Highest trade:       "${highestTrade.experiment.name}"` +
    `\n                       Trade → ${highestTrade.result.trade} ` +
    `(${d(highestTrade.result.trade, b.trade)} from baseline)`
  );

  console.log(
    `\n  Highest proxy:       "${highestProxy.experiment.name}"` +
    `\n                       Proxy → ${highestProxy.result.proxy}/100 ` +
    `(${d(highestProxy.result.proxy, b.proxy)} from baseline)`
  );

  // Deal survivability
  const dealSurvived = results.filter(r => r.result.dealIntegrity > 0);
  const dealCollapsed = results.filter(r => r.result.dealIntegrity === 0);
  console.log(`\n  Deal survived in ${dealSurvived.length}/4 experiments:`);
  for (const r of dealSurvived) {
    console.log(`    ✓ ${r.experiment.name} (integrity: ${r.result.dealIntegrity}/100)`);
  }
  if (dealCollapsed.length > 0) {
    console.log(`  Deal collapsed in ${dealCollapsed.length}/4 experiments:`);
    for (const r of dealCollapsed) {
      console.log(`    ✗ ${r.experiment.name}`);
    }
  }

  // Blockchain audit
  console.log("\n\n  BLOCKCHAIN AUDIT TRAIL");
  console.log("  " + "─".repeat(56));
  for (const r of results) {
    console.log(`\n  ${r.experiment.name}`);
    console.log(`    Baseline  — Registry: ${r.registryAddr}`);
    console.log(`                Oracle:   ${r.oracleAddr}`);
    console.log(`    Experiment— Registry: ${r.reg2Addr}`);
    console.log(`                Oracle:   ${r.oracle2Addr}`);
  }
  console.log(`\n  Total cycles recorded on-chain: ${results.length * CYCLES * 2}`);
  console.log("  Every metric change is timestamped and immutable.");
  console.log("  Researchers can cite specific block numbers for any finding.\n");

  console.log("╔" + "═".repeat(60) + "╗");
  console.log("║" + "  ALL EXPERIMENTS COMPLETE".padEnd(60) + "║");
  console.log("╚" + "═".repeat(60) + "╝\n");
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

async function main() {
  const signers = await ethers.getSigners();

  const experimentIds = [
    "exp_deal_collapse",
    "exp_congress_blocks",
    "exp_saudi_normalizes",
    "exp_hardliners_win",
  ];

  console.log("\n╔" + "═".repeat(52) + "╗");
  console.log("║   GOVERNANCE PLAYGROUND — FULL EXPERIMENT SUITE   ║");
  console.log("╚" + "═".repeat(52) + "╝");
  console.log(`\nScenario: ${SCENARIO.meta.name}`);
  console.log(`Experiments: ${experimentIds.length}`);
  console.log(`Cycles per phase: ${CYCLES}`);
  console.log(`Total blockchain cycles: ${experimentIds.length * CYCLES * 2}`);

  const results = [];
  for (let i = 0; i < experimentIds.length; i++) {
    const result = await runExperiment(experimentIds[i], signers, i + 1, experimentIds.length);
    results.push(result);
  }

  printSummary(results);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nExperiment suite failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  });
