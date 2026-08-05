/**
 * GOVERNANCE PLAYGROUND — Deploy Script
 *
 * This script reads the Middle East 2026 scenario config and deploys
 * the full simulation to a local Hardhat network (or any EVM chain).
 *
 * What it does, in order:
 *   1. Deploy WorldRegistry (the simulation controller)
 *   2. Deploy MetricsOracle (the measurement engine)
 *   3. Wire them together
 *   4. Initialize the scenario
 *   5. Deploy each nation (Israel, Iran, Saudi Arabia)
 *   6. Distribute citizen tokens
 *   7. Set up relationships between nations
 *   8. Register active events (the peace deal)
 *   9. Print a deployment summary
 *
 * Run with:
 *   npx hardhat run scripts/deploy.js --network hardhat
 */

const { ethers } = require("hardhat");
const SCENARIO   = require("../scenarios/middle-east-2026.config.cjs");

// ─────────────────────────────────────────────────────────────
// GOVERNANCE TYPE MAPPING
// Maps config strings to contract enum values
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

// ─────────────────────────────────────────────────────────────
// HELPER: Build NationConfig struct from scenario config
// ─────────────────────────────────────────────────────────────

function buildNationConfig(nation, signers) {
  const gov = nation.governance;

  // For nations with veto powers, assign real addresses
  // In production these would be multisig wallets
  // For local testing we use signer addresses
  const guardianCouncil  = gov.guardianVeto  ? signers[1].address : ethers.ZeroAddress;
  const royalAuthority   = gov.royalVeto     ? signers[2].address : ethers.ZeroAddress;

  return {
    name:               nation.name,
    nationId:           nation.id,
    governanceType:     GovernanceType[gov.type],
    votingMechanism:    VotingMechanism[gov.votingMechanism],
    proposalThreshold:  BigInt(gov.proposalThreshold),
    quorumPercent:      BigInt(gov.quorum),

    // ~1 day voting delay  (7200 blocks at 12s/block)
    // ~1 week voting period (50400 blocks)
    // ~2 day timelock      (14400 blocks)
    // For local testing these are shortened to 1, 5, 2 blocks
    votingDelayBlocks:  BigInt(1),
    votingPeriodBlocks: BigInt(5),
    timelockBlocks:     BigInt(2),

    hasGuardianVeto:    gov.guardianVeto  || false,
    hasRoyalVeto:       gov.royalVeto     || false,
    guardianCouncil:    guardianCouncil,
    royalAuthority:     royalAuthority,

    hardlinerPressure:  BigInt(gov.hardlinerPressure || 0),
    reformPressure:     BigInt(gov.reformPressure    || 0),
  };
}

// ─────────────────────────────────────────────────────────────
// MAIN DEPLOY
// ─────────────────────────────────────────────────────────────

async function main() {
  const signers  = await ethers.getSigners();
  const deployer = signers[0];

  console.log("\n========================================");
  console.log("  GOVERNANCE PLAYGROUND — DEPLOY");
  console.log("========================================");
  console.log(`Scenario:  ${SCENARIO.meta.name}`);
  console.log(`Version:   ${SCENARIO.meta.version}`);
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Nations:   ${SCENARIO.nations.length}`);
  console.log("========================================\n");

  // ── STEP 1: Deploy WorldRegistry ──────────────────────────

  console.log("Step 1: Deploying WorldRegistry...");

  const WorldRegistry = await ethers.getContractFactory("WorldRegistry");
  const registry      = await WorldRegistry.deploy(deployer.address);
  await registry.waitForDeployment();

  console.log(`  WorldRegistry: ${await registry.getAddress()}`);

  // ── STEP 2: Deploy MetricsOracle ──────────────────────────

  console.log("\nStep 2: Deploying MetricsOracle...");

  const MetricsOracle = await ethers.getContractFactory("MetricsOracle");
  const oracle        = await MetricsOracle.deploy(
    await registry.getAddress(),
    deployer.address
  );
  await oracle.waitForDeployment();

  console.log(`  MetricsOracle: ${await oracle.getAddress()}`);

  // ── STEP 3: Wire them together ────────────────────────────

  console.log("\nStep 3: Wiring contracts together...");

  await (await registry.setMetricsOracle(await oracle.getAddress())).wait();
  console.log("  MetricsOracle registered with WorldRegistry");

  const CitizenTokenFactory = await ethers.getContractFactory("CitizenTokenFactory");
  const tokenFactory        = await CitizenTokenFactory.deploy();
  await tokenFactory.waitForDeployment();

  const NationDAOFactory = await ethers.getContractFactory("NationDAOFactory");
  const daoFactory       = await NationDAOFactory.deploy();
  await daoFactory.waitForDeployment();

  await (await registry.setNationFactories(
    await tokenFactory.getAddress(),
    await daoFactory.getAddress()
  )).wait();
  console.log(`  CitizenTokenFactory: ${await tokenFactory.getAddress()}`);
  console.log(`  NationDAOFactory:    ${await daoFactory.getAddress()}`);

  // ── STEP 4: Initialize the scenario ──────────────────────

  console.log("\nStep 4: Initializing scenario...");

  await (await registry.initializeScenario(
    SCENARIO.meta.name,
    SCENARIO.meta.version,
    BigInt(SCENARIO.simulation.defaultCycles)
  )).wait();

  console.log(`  Scenario: "${SCENARIO.meta.name}" initialized`);
  console.log(`  Total cycles: ${SCENARIO.simulation.defaultCycles}`);

  // ── STEP 5: Deploy each nation ────────────────────────────

  console.log("\nStep 5: Deploying nations...");

  const deployedNations = {};

  for (const nation of SCENARIO.nations) {
    console.log(`\n  Deploying ${nation.flag} ${nation.name}...`);

    const nationConfig = buildNationConfig(nation, signers);

    // Token supply — scaled by 1e18 (standard ERC20 decimals)
    // We use population size as a rough proxy for token supply
    const tokenSupply = BigInt(1_000_000) * BigInt(10 ** 18);

    const tx = await registry.registerNation(
      nationConfig,
      tokenSupply,
      BigInt(nation.economy.treasury),
      BigInt(nation.military.power)
    );

    const receipt = await tx.wait();

    // Read the deployed addresses from the registry
    const registeredNation = await registry.getNation(nation.id);

    deployedNations[nation.id] = {
      dao:   registeredNation.daoAddress,
      token: registeredNation.tokenAddress,
      name:  nation.name,
    };

    console.log(`    DAO Token:  ${registeredNation.tokenAddress}`);
    console.log(`    NationDAO:  ${registeredNation.daoAddress}`);
    console.log(`    Treasury:   ${nation.economy.treasury} units`);
    console.log(`    Military:   ${nation.military.power} power`);
    console.log(`    Governance: ${nation.governance.type}`);
  }

  // ── STEP 6: Distribute citizenship tokens ────────────────

  console.log("\nStep 6: Distributing citizenship tokens...");

  // For the simulation, we distribute tokens across test accounts
  // representing different population segments:
  //   signers[0] = deployer / researcher
  //   signers[3] = moderate citizens
  //   signers[4] = hardliner faction
  //   signers[5] = reformist faction

  const citizenDistribution = {
    israel: [
      { address: signers[0].address, amount: BigInt(200_000) * BigInt(10**18) },
      { address: signers[3].address, amount: BigInt(500_000) * BigInt(10**18) },
      { address: signers[4].address, amount: BigInt(200_000) * BigInt(10**18) },
      { address: signers[5].address, amount: BigInt(100_000) * BigInt(10**18) },
    ],
    iran: [
      { address: signers[0].address, amount: BigInt(100_000) * BigInt(10**18) },
      { address: signers[3].address, amount: BigInt(300_000) * BigInt(10**18) },
      { address: signers[4].address, amount: BigInt(500_000) * BigInt(10**18) }, // hardliners dominant
      { address: signers[5].address, amount: BigInt(100_000) * BigInt(10**18) },
    ],
    saudi_arabia: [
      { address: signers[2].address, amount: BigInt(800_000) * BigInt(10**18) }, // royal authority dominant
      { address: signers[3].address, amount: BigInt(150_000) * BigInt(10**18) },
      { address: signers[5].address, amount: BigInt(50_000)  * BigInt(10**18) },
    ],
  };

  for (const [nationId, distribution] of Object.entries(citizenDistribution)) {
    const addresses = distribution.map(d => d.address);
    const amounts   = distribution.map(d => d.amount);

    await (await registry.distributeCitizenship(nationId, addresses, amounts)).wait();
    console.log(`  Distributed tokens for ${deployedNations[nationId].name}`);
  }

  // ── STEP 7: Set up relationships ─────────────────────────

  console.log("\nStep 7: Setting up relationships...");

  for (const rel of SCENARIO.relationships) {
    const relTypeEnum = RelationshipType[rel.type] ?? RelationshipType.NEUTRAL;

    await (await registry.setRelationship(
      rel.from,
      rel.to,
      relTypeEnum,
      BigInt(rel.stabilityScore),
      rel.treatyActive,
      rel.treatyName || ""
    )).wait();

    console.log(
      `  ${rel.from} <-> ${rel.to}: ${rel.type} ` +
      `(stability: ${rel.stabilityScore}/100)`
    );
  }

  // ── STEP 8: Register active global events ────────────────

  console.log("\nStep 8: Registering active events...");

  for (const event of SCENARIO.activeEvents) {
    if (event.type === "PEACE_DEAL" || event.type === "RESOURCE_EVENT") {
      const eventTypeEnum = EventType[event.type] ?? EventType.PEACE_DEAL;

      await (await registry.createGlobalEvent(
        event.id,
        event.name,
        eventTypeEnum,
        event.parties || [],
        event.description
      )).wait();

      console.log(`  Event registered: "${event.name}" — ${event.status}`);
    }
  }

  // ── STEP 9: Set initial metrics ──────────────────────────

  console.log("\nStep 9: Setting initial metrics...");

  const metrics = SCENARIO.simulation.metrics;
  const stabilityMetric    = metrics.find(m => m.id === "stability_index");
  const conflictMetric     = metrics.find(m => m.id === "conflict_events");
  const tradeMetric        = metrics.find(m => m.id === "trade_volume");
  const proxyMetric        = metrics.find(m => m.id === "proxy_activity");
  const dealIntegrityMetric = metrics.find(m => m.id === "deal_integrity");

  await (await oracle.updateMetrics(
    BigInt(stabilityMetric.startingValue),
    BigInt(conflictMetric.startingValue),
    BigInt(tradeMetric.startingValue),
    BigInt(proxyMetric.startingValue),
    BigInt(dealIntegrityMetric.startingValue)
  )).wait();

  console.log(`  Stability Index:    ${stabilityMetric.startingValue}/100`);
  console.log(`  Conflict Events:    ${conflictMetric.startingValue}`);
  console.log(`  Trade Volume:       ${tradeMetric.startingValue}`);
  console.log(`  Proxy Activity:     ${proxyMetric.startingValue}`);
  console.log(`  Deal Integrity:     ${dealIntegrityMetric.startingValue}/100`);

  // ── STEP 10: Start the simulation ────────────────────────

  console.log("\nStep 10: Starting simulation...");
  await (await registry.startSimulation()).wait();
  console.log("  Simulation is ACTIVE");

  // ── DEPLOYMENT SUMMARY ───────────────────────────────────

  console.log("\n========================================");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("========================================");
  console.log(`\nCore Contracts:`);
  console.log(`  WorldRegistry:  ${await registry.getAddress()}`);
  console.log(`  MetricsOracle:  ${await oracle.getAddress()}`);

  console.log(`\nNations:`);
  for (const [id, nation] of Object.entries(deployedNations)) {
    console.log(`\n  ${nation.name}`);
    console.log(`    Token: ${nation.token}`);
    console.log(`    DAO:   ${nation.dao}`);
  }

  console.log(`\nStarting Metrics:`);
  console.log(`  Regional Stability: ${stabilityMetric.startingValue}/100 (FRAGILE)`);
  console.log(`  Peace Deal Integrity: ${dealIntegrityMetric.startingValue}/100`);

  console.log(`\nSuggested first experiment:`);
  console.log(`  "${SCENARIO.experiments[0].question}"`);
  console.log(`\nRun: npx hardhat run scripts/run-experiment.js`);
  console.log("\n========================================\n");

  // Return addresses for use in tests
  return {
    registry: await registry.getAddress(),
    oracle:   await oracle.getAddress(),
    nations:  deployedNations,
  };
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nDeployment failed:", err.message);
    process.exit(1);
  });
