/**
 * GOVERNANCE PLAYGROUND — Experiment Runner
 *
 * Runs a controlled "what if" experiment against the Middle East scenario.
 * Produces a structured research report comparing baseline vs. experiment.
 *
 * Structure:
 *   PHASE 1 — Setup:     Deploy the full scenario fresh
 *   PHASE 2 — Baseline:  Run N cycles with no changes (control group)
 *   PHASE 3 — Experiment: Apply one change, run same N cycles
 *   PHASE 4 — Analysis:  Compare results, print findings
 *
 * The experiment to run is selected by ID from the scenario config.
 * Default: "exp_deal_collapse" — what happens if the peace deal collapses?
 *
 * Usage:
 *   npx hardhat run scripts/run-experiment.js --network hardhat
 *
 * To run a different experiment, set EXPERIMENT_ID at the top of this file.
 */

const { ethers } = require("hardhat");
const SCENARIO   = require("../scenarios/middle-east-2026.config.cjs");

// ─────────────────────────────────────────────────────────────
// SELECT EXPERIMENT
// Change this to run a different pre-built experiment
// ─────────────────────────────────────────────────────────────

const EXPERIMENT_ID = "exp_deal_collapse";
const CYCLES        = 10;    // cycles to run per phase

// ─────────────────────────────────────────────────────────────
// ENUM MAPS (same as deploy.js)
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

// EventStatus enum values from WorldRegistry.sol
const EventStatus = {
  PENDING:        0,
  ACTIVE:         1,
  ACTIVE_FRAGILE: 2,
  RESOLVED:       3,
  COLLAPSED:      4,
};

// ─────────────────────────────────────────────────────────────
// SIMULATION ENGINE
// Drives metric changes each cycle based on the current state.
// In a full implementation this would read live DAO proposals.
// Here we use a rules-based model derived from the scenario config.
// ─────────────────────────────────────────────────────────────

class SimulationEngine {
  constructor(oracle, registry, scenario) {
    this.oracle   = oracle;
    this.registry = registry;
    this.scenario = scenario;

    // Current state — initialized from scenario starting values
    const m = scenario.simulation.metrics;
    this.state = {
      stability:     m.find(x => x.id === "stability_index").startingValue,
      conflicts:     m.find(x => x.id === "conflict_events").startingValue,
      trade:         m.find(x => x.id === "trade_volume").startingValue,
      proxy:         m.find(x => x.id === "proxy_activity").startingValue,
      dealIntegrity: m.find(x => x.id === "deal_integrity").startingValue,
    };

    // Track whether deal is active — drives most dynamics
    this.dealActive = true;

    // Track history for graphing
    this.history = [];
  }

  // Apply one experiment change to the engine state
  applyExperiment(experimentId) {
    const exp = this.scenario.experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);

    if (experimentId === "exp_deal_collapse") {
      this.dealActive = false;
      // Immediate shock when deal collapses
      this.state.stability     = Math.max(0,   this.state.stability     - 18);
      this.state.dealIntegrity = 0;
      this.state.conflicts    += 4;
      this.state.proxy        += 20;
    }

    if (experimentId === "exp_congress_blocks") {
      // Sanctions relief blocked — Iran's incentive weakens
      this.state.dealIntegrity -= 25;
      this.state.proxy         += 10;
    }

    if (experimentId === "exp_saudi_normalizes") {
      // New alliance opens — trade surges, Iran feels encircled
      this.state.trade      += 200;
      this.state.stability  += 12;
      this.state.proxy      += 8;   // Iran responds with more proxy activity
    }

    if (experimentId === "exp_hardliners_win") {
      // Hardliners in control — deal at immediate risk
      this.state.dealIntegrity -= 35;
      this.state.proxy         += 25;
      this.state.stability     -= 10;
    }

    return exp;
  }

  // Advance one simulation cycle
  // Rules are derived from international relations theory:
  //   - Fragile deals decay slowly unless reinforced
  //   - High proxy activity destabilizes trade
  //   - Stability and trade are positively correlated
  //   - Conflict events spike when deal integrity is low
  tick(cycleNum) {
    const s = this.state;

    if (this.dealActive) {
      // Deal is holding — slow drift toward stability
      // But deal integrity decays slightly each cycle (entropy)
      s.dealIntegrity = Math.max(0, s.dealIntegrity - 2);

      // If deal integrity drops below 20, it starts fragmenting
      if (s.dealIntegrity < 20) {
        s.stability  = Math.max(0,  s.stability  - 3);
        s.conflicts += 1;
        s.proxy      = Math.min(100, s.proxy + 3);
      } else {
        // Deal holding — gradual improvement
        s.stability  = Math.min(100, s.stability + 1);
        s.trade      = Math.min(500, s.trade + 8);
        s.proxy      = Math.max(0,   s.proxy - 1);
        s.conflicts  = Math.max(0,   s.conflicts - 1);
      }
    } else {
      // Deal collapsed — cascading deterioration
      s.dealIntegrity = 0;
      s.conflicts    += Math.floor(Math.random() * 3) + 2;
      s.proxy         = Math.min(100, s.proxy + 5);
      s.trade         = Math.max(0,   s.trade - 15);
      s.stability     = Math.max(0,   s.stability - 4);

      // Hormuz threat — spikes every 3 cycles when deal is dead
      if (cycleNum % 3 === 0) {
        s.trade     = Math.max(0,   s.trade     - 30);
        s.stability = Math.max(0,   s.stability - 5);
        s.conflicts += 3;
      }
    }

    // Clamp all values
    s.stability     = Math.min(100, Math.max(0, Math.round(s.stability)));
    s.conflicts     = Math.max(0,   Math.round(s.conflicts));
    s.trade         = Math.max(0,   Math.round(s.trade));
    s.proxy         = Math.min(100, Math.max(0, Math.round(s.proxy)));
    s.dealIntegrity = Math.min(100, Math.max(0, Math.round(s.dealIntegrity)));

    // Record this cycle
    this.history.push({ cycle: cycleNum, ...s });

    return { ...s };
  }

  snapshot() {
    return { ...this.state };
  }
}

// ─────────────────────────────────────────────────────────────
// DEPLOY HELPER (mirrors deploy.js — self-contained)
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

  // Deploy core contracts
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

  // Initialize scenario
  await registry.initializeScenario(
    SCENARIO.meta.name,
    SCENARIO.meta.version,
    BigInt(SCENARIO.simulation.defaultCycles)
  );

  // Deploy nations
  const deployedNations = {};
  for (const nation of SCENARIO.nations) {
    const config      = buildNationConfig(nation, signers);
    const tokenSupply = BigInt(1_000_000) * BigInt(10**18);
    await registry.registerNation(
      config,
      tokenSupply,
      BigInt(nation.economy.treasury),
      BigInt(nation.military.power)
    );
    const registered = await registry.getNation(nation.id);
    deployedNations[nation.id] = {
      dao: registered.daoAddress, token: registered.tokenAddress,
    };
  }

  // Distribute tokens
  const dist = {
    israel:       [
      [signers[0].address, signers[3].address, signers[4].address, signers[5].address],
      [200_000n, 500_000n, 200_000n, 100_000n].map(n => n * BigInt(10**18)),
    ],
    iran:         [
      [signers[0].address, signers[3].address, signers[4].address, signers[5].address],
      [100_000n, 300_000n, 500_000n, 100_000n].map(n => n * BigInt(10**18)),
    ],
    saudi_arabia: [
      [signers[2].address, signers[3].address, signers[5].address],
      [800_000n, 150_000n, 50_000n].map(n => n * BigInt(10**18)),
    ],
  };
  for (const [id, [addrs, amounts]] of Object.entries(dist)) {
    await registry.distributeCitizenship(id, addrs, amounts);
  }

  // Set relationships
  for (const rel of SCENARIO.relationships) {
    await registry.setRelationship(
      rel.from, rel.to,
      RelationshipType[rel.type] ?? RelationshipType.NEUTRAL,
      BigInt(rel.stabilityScore),
      rel.treatyActive, rel.treatyName || ""
    );
  }

  // Register events
  for (const evt of SCENARIO.activeEvents) {
    if (evt.type === "PEACE_DEAL" || evt.type === "RESOURCE_EVENT") {
      await registry.createGlobalEvent(
        evt.id, evt.name,
        EventType[evt.type] ?? EventType.PEACE_DEAL,
        evt.parties || [], evt.description
      );
    }
  }

  // Set initial metrics
  const m = SCENARIO.simulation.metrics;
  await oracle.updateMetrics(
    BigInt(m.find(x => x.id === "stability_index").startingValue),
    BigInt(m.find(x => x.id === "conflict_events").startingValue),
    BigInt(m.find(x => x.id === "trade_volume").startingValue),
    BigInt(m.find(x => x.id === "proxy_activity").startingValue),
    BigInt(m.find(x => x.id === "deal_integrity").startingValue)
  );

  await registry.startSimulation();

  return { registry, oracle, deployedNations };
}

// ─────────────────────────────────────────────────────────────
// REPORTING
// ─────────────────────────────────────────────────────────────

function bar(value, max = 100, width = 20) {
  const filled = Math.round((value / max) * width);
  const empty  = width - filled;
  return "[" + "█".repeat(filled) + "░".repeat(empty) + "]";
}

function delta(after, before) {
  const diff = after - before;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${diff}`;
}

function stabilityLabel(score) {
  if (score >= 75) return "STABLE";
  if (score >= 50) return "MODERATE";
  if (score >= 25) return "FRAGILE";
  return "CRITICAL";
}

function printCycleTable(history) {
  console.log(
    "\n  Cycle  Stability  Conflicts  Trade  Proxy  Deal"
  );
  console.log("  " + "─".repeat(54));
  for (const h of history) {
    console.log(
      `  ${String(h.cycle).padStart(5)}  ` +
      `${String(h.stability).padStart(9)}  ` +
      `${String(h.conflicts).padStart(9)}  ` +
      `${String(h.trade).padStart(5)}  ` +
      `${String(h.proxy).padStart(5)}  ` +
      `${String(h.dealIntegrity).padStart(4)}`
    );
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

async function main() {
  const signers = await ethers.getSigners();

  // Find the experiment
  const experiment = SCENARIO.experiments.find(e => e.id === EXPERIMENT_ID);
  if (!experiment) {
    throw new Error(`Experiment "${EXPERIMENT_ID}" not found in scenario config`);
  }

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║     GOVERNANCE PLAYGROUND — EXPERIMENT RUNNER    ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\nScenario:    ${SCENARIO.meta.name}`);
  console.log(`Experiment:  ${experiment.name}`);
  console.log(`Question:    "${experiment.question}"`);
  console.log(`Hypothesis:  "${experiment.hypothesis}"`);
  console.log(`Cycles:      ${CYCLES} per phase`);

  // ── PHASE 1: Setup ──────────────────────────────────────

  console.log("\n┌─────────────────────────────────────┐");
  console.log("│  PHASE 1 — DEPLOYING SCENARIO        │");
  console.log("└─────────────────────────────────────┘");

  const { registry, oracle } = await deployScenario(signers);

  console.log(`  WorldRegistry: ${await registry.getAddress()}`);
  console.log(`  MetricsOracle: ${await oracle.getAddress()}`);
  console.log("  All 3 nations deployed and configured");

  // ── PHASE 2: Baseline Run ───────────────────────────────

  console.log("\n┌─────────────────────────────────────┐");
  console.log("│  PHASE 2 — BASELINE (no change)      │");
  console.log("└─────────────────────────────────────┘");
  console.log("  Running with current state — no experiment applied\n");

  const baselineEngine = new SimulationEngine(oracle, registry, SCENARIO);
  const baselineStart  = baselineEngine.snapshot();

  // Set baseline before running
  await oracle.updateMetrics(
    BigInt(baselineStart.stability),
    BigInt(baselineStart.conflicts),
    BigInt(baselineStart.trade),
    BigInt(baselineStart.proxy),
    BigInt(baselineStart.dealIntegrity)
  );
  await registry.advanceCycle();
  await oracle.setBaseline(1);

  // Run baseline cycles
  for (let i = 1; i <= CYCLES; i++) {
    const metrics = baselineEngine.tick(i);

    // Write metrics to chain each cycle
    await oracle.updateMetrics(
      BigInt(metrics.stability),
      BigInt(metrics.conflicts),
      BigInt(metrics.trade),
      BigInt(metrics.proxy),
      BigInt(metrics.dealIntegrity)
    );
    await registry.advanceCycle();

    process.stdout.write(
      `  Cycle ${String(i).padStart(2)}/${CYCLES} — ` +
      `Stability: ${String(metrics.stability).padStart(3)}/100  ` +
      `Deal Integrity: ${String(metrics.dealIntegrity).padStart(3)}/100  ` +
      `Conflicts: ${metrics.conflicts}\n`
    );
  }

  const baselineEnd = baselineEngine.snapshot();
  printCycleTable(baselineEngine.history);

  // ── PHASE 3: Experiment Run ─────────────────────────────

  console.log("\n┌─────────────────────────────────────┐");
  console.log(`│  PHASE 3 — EXPERIMENT APPLIED        │`);
  console.log("└─────────────────────────────────────┘");
  console.log(`  Applying: "${experiment.name}"`);

  // Deploy a fresh instance for the experiment run
  const { registry: reg2, oracle: oracle2 } = await deployScenario(signers);

  const expEngine = new SimulationEngine(oracle2, reg2, SCENARIO);

  // Apply the experiment at cycle 1
  expEngine.applyExperiment(EXPERIMENT_ID);

  // Register the experiment on-chain
  await oracle2.recordExperiment(
    EXPERIMENT_ID,
    "global",
    experiment.change.target,
    BigInt(0),
    BigInt(0)
  );

  // Update event status on-chain if it's a deal collapse
  if (EXPERIMENT_ID === "exp_deal_collapse") {
    await reg2.updateEventStatus("hormuz_nuclear_deal", EventStatus.COLLAPSED);
    console.log("  Peace deal status: COLLAPSED");
    console.log("  Cascading effects: Israel<->Iran -> HOSTILE\n");
  }

  // Run experiment cycles
  for (let i = 1; i <= CYCLES; i++) {
    const metrics = expEngine.tick(i);

    await oracle2.updateMetrics(
      BigInt(metrics.stability),
      BigInt(metrics.conflicts),
      BigInt(metrics.trade),
      BigInt(metrics.proxy),
      BigInt(metrics.dealIntegrity)
    );
    await reg2.advanceCycle();

    process.stdout.write(
      `  Cycle ${String(i).padStart(2)}/${CYCLES} — ` +
      `Stability: ${String(metrics.stability).padStart(3)}/100  ` +
      `Deal Integrity: ${String(metrics.dealIntegrity).padStart(3)}/100  ` +
      `Conflicts: ${metrics.conflicts}\n`
    );
  }

  const expEnd = expEngine.snapshot();
  printCycleTable(expEngine.history);

  // ── PHASE 4: Analysis & Report ──────────────────────────

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║              RESEARCH FINDINGS                    ║");
  console.log("╚══════════════════════════════════════════════════╝");

  console.log(`\nExperiment:  ${experiment.name}`);
  console.log(`Question:    "${experiment.question}"`);
  console.log(`Cycles run:  ${CYCLES} per phase`);

  console.log("\n────────────────────────────────────────────────────");
  console.log("  METRIC COMPARISON — END OF SIMULATION");
  console.log("────────────────────────────────────────────────────");
  console.log(
    `${"Metric".padEnd(22)} ${"Baseline".padStart(8)} ` +
    `${"Experiment".padStart(10)} ${"Delta".padStart(7)}`
  );
  console.log("  " + "─".repeat(50));

  const metrics = [
    {
      name:       "Stability Index",
      baseline:   baselineEnd.stability,
      experiment: expEnd.stability,
      unit:       "/100",
    },
    {
      name:       "Conflict Events",
      baseline:   baselineEnd.conflicts,
      experiment: expEnd.conflicts,
      unit:       "",
    },
    {
      name:       "Trade Volume",
      baseline:   baselineEnd.trade,
      experiment: expEnd.trade,
      unit:       "",
    },
    {
      name:       "Proxy Activity",
      baseline:   baselineEnd.proxy,
      experiment: expEnd.proxy,
      unit:       "/100",
    },
    {
      name:       "Deal Integrity",
      baseline:   baselineEnd.dealIntegrity,
      experiment: expEnd.dealIntegrity,
      unit:       "/100",
    },
  ];

  for (const m of metrics) {
    const d    = m.experiment - m.baseline;
    const sign = d >= 0 ? "+" : "";
    const flag = Math.abs(d) >= 15 ? " ◄ SIGNIFICANT" : "";
    console.log(
      `  ${m.name.padEnd(20)} ` +
      `${String(m.baseline  + m.unit).padStart(8)} ` +
      `${String(m.experiment + m.unit).padStart(10)} ` +
      `${(sign + d).padStart(7)}${flag}`
    );
  }

  console.log("\n────────────────────────────────────────────────────");
  console.log("  STABILITY TRAJECTORY");
  console.log("────────────────────────────────────────────────────");

  console.log("\n  Baseline (deal holds):");
  for (const h of baselineEngine.history) {
    console.log(
      `    Cycle ${String(h.cycle).padStart(2)}: ${bar(h.stability)} ${h.stability}/100`
    );
  }

  console.log(`\n  Experiment (${experiment.name}):`);
  for (const h of expEngine.history) {
    console.log(
      `    Cycle ${String(h.cycle).padStart(2)}: ${bar(h.stability)} ${h.stability}/100`
    );
  }

  console.log("\n────────────────────────────────────────────────────");
  console.log("  FINDINGS");
  console.log("────────────────────────────────────────────────────\n");

  const stabilityDelta = expEnd.stability - baselineEnd.stability;
  const conflictDelta  = expEnd.conflicts  - baselineEnd.conflicts;
  const tradeDelta     = expEnd.trade      - baselineEnd.trade;
  const proxyDelta     = expEnd.proxy      - baselineEnd.proxy;

  console.log(
    `  1. STABILITY: The region ended at ${expEnd.stability}/100 ` +
    `(${stabilityLabel(expEnd.stability)}) under the experiment,\n` +
    `     compared to ${baselineEnd.stability}/100 ` +
    `(${stabilityLabel(baselineEnd.stability)}) in the baseline.\n` +
    `     Net change: ${delta(expEnd.stability, baselineEnd.stability)} points.`
  );

  console.log(
    `\n  2. CONFLICT: ${conflictDelta > 0 ? "Conflict events increased by " + conflictDelta : "Conflict events decreased by " + Math.abs(conflictDelta)}.` +
    `\n     Total events in experiment run: ${expEnd.conflicts}.`
  );

  console.log(
    `\n  3. TRADE: Trade volume ${tradeDelta < 0 ? "collapsed by " + Math.abs(tradeDelta) + " units" : "increased by " + tradeDelta + " units"}.` +
    `\n     From ${baselineEnd.trade} (baseline) to ${expEnd.trade} (experiment).`
  );

  console.log(
    `\n  4. PROXY ACTIVITY: ${proxyDelta > 0 ? "Rose by " + proxyDelta : "Fell by " + Math.abs(proxyDelta)} points.` +
    `\n     Experiment ended at ${expEnd.proxy}/100.`
  );

  console.log("\n────────────────────────────────────────────────────");
  console.log("  HYPOTHESIS CHECK");
  console.log("────────────────────────────────────────────────────");
  console.log(`\n  Hypothesis: "${experiment.hypothesis}"\n`);

  // Auto-evaluate hypothesis for deal collapse
  if (EXPERIMENT_ID === "exp_deal_collapse") {
    const hormuzTriggered = expEnd.trade < baselineEnd.trade * 0.6;
    const stabilityDrop   = baselineEnd.stability - expEnd.stability >= 15;
    const proxySpike      = expEnd.proxy > baselineEnd.proxy + 15;

    console.log(`  Hormuz closure impact (trade dropped >40%): ${hormuzTriggered ? "YES ✓" : "NOT YET"}`);
    console.log(`  Stability dropped below 20:                 ${expEnd.stability < 20 ? "YES ✓" : `NO — reached ${expEnd.stability}`}`);
    console.log(`  Proxy activity surged significantly:        ${proxySpike ? "YES ✓" : "NO"}`);
    console.log(`  Significant stability degradation (>15pts): ${stabilityDrop ? "YES ✓" : "NO"}`);
  }

  console.log("\n────────────────────────────────────────────────────");
  console.log("  BLOCKCHAIN AUDIT TRAIL");
  console.log("────────────────────────────────────────────────────");
  console.log(`\n  WorldRegistry (baseline): ${await registry.getAddress()}`);
  console.log(`  MetricsOracle (baseline): ${await oracle.getAddress()}`);
  console.log(`  WorldRegistry (experiment): ${await reg2.getAddress()}`);
  console.log(`  MetricsOracle (experiment): ${await oracle2.getAddress()}`);
  console.log(`\n  All ${CYCLES * 2} cycles recorded on-chain.`);
  console.log("  Every metric change is timestamped and immutable.");
  console.log("  Researchers can cite specific block numbers.\n");

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║              EXPERIMENT COMPLETE                  ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nExperiment failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  });
