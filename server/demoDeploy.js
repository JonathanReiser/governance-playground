/**
 * Server-signed scenario deployment for the no-wallet demo path.
 *
 * Deliberately NOT a generic "sign whatever transaction the client sends
 * me" relayer — that would let anyone use the demo wallet's funded key to
 * deploy arbitrary bytecode or spam arbitrary contracts on Sepolia, unrelated
 * to this app entirely. Instead, this module only ever runs ONE fixed
 * sequence — deploy this repo's own known contracts for one of this repo's
 * own known scenarios — driven by a scenarioId the caller picks from an
 * allowlist, never by client-supplied bytecode or calldata. The blast
 * radius of abuse is bounded to "someone spam-deploys demo scenarios and
 * drains the demo wallet's testnet ETH," not "someone uses this server as
 * an open relayer."
 *
 * Deploy logic itself is a straight port of frontend/src/lib/contracts.js's
 * deployScenario() — same steps, same order, verified against it directly
 * — duplicated rather than shared because the frontend is ESM (Vite) and
 * this server is CommonJS (kept that way deliberately, per server.js's own
 * header comment, to avoid breaking Hardhat). Two copies of ~80 lines of
 * deploy logic is a real cost; fighting a module-system mismatch in a
 * production app the night before a public launch is a worse one. If the
 * two ever drift, `scripts/deploy.js`'s existing test coverage plus a
 * manual diff against contracts.js is the check — see README.
 */

const { ethers } = require("ethers");

const WorldRegistryABI       = require("../frontend/src/abi/WorldRegistry.json");
const MetricsOracleABI       = require("../frontend/src/abi/MetricsOracle.json");
const CitizenTokenFactoryABI = require("../frontend/src/abi/CitizenTokenFactory.json");
const NationDAOFactoryABI    = require("../frontend/src/abi/NationDAOFactory.json");

const SCENARIOS = {
  "middle-east-2026": require("../frontend/src/scenarios/middle-east-2026.json"),
  "taiwan-strait-2026": require("../frontend/src/scenarios/taiwan-strait-2026.json"),
};

const GovernanceType   = { PARLIAMENTARY_DEMOCRACY: 0, THEOCRATIC_REPUBLIC: 1, ABSOLUTE_MONARCHY: 2, FEDERAL_REPUBLIC: 3, MILITARY_JUNTA: 4 };
const VotingMechanism  = { ONE_TOKEN_ONE_VOTE: 0, DUAL_LAYER: 1, COUNCIL_WEIGHTED: 2, QUADRATIC: 3 };
const RelationshipType = { ALLIED: 0, PARTNER: 1, NEUTRAL: 2, FRAGILE_PEACE: 3, COLD: 4, SANCTIONED: 5, HOSTILE: 6 };
const EventType        = { PEACE_DEAL: 0, WAR: 1, RESOURCE_EVENT: 2, ECONOMIC_CRISIS: 3, ELECTION: 4, COUP: 5, SANCTIONS: 6 };

let _provider = null;
let _signer = null;

function getDemoProvider() {
  if (!_provider) {
    const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
    _provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return _provider;
}

/** NonceManager, same as Dev Mode's HARDHAT_PRIVATE_KEY wallet in
 * contracts.js — several visitors could hit /api/demo/deploy close
 * together, and without this the wallet's nonce tracking races. */
function getDemoSigner() {
  if (!process.env.DEMO_PRIVATE_KEY) {
    throw new Error("DEMO_PRIVATE_KEY not set — no-wallet demo path is disabled.");
  }
  if (!_signer) {
    const wallet = new ethers.Wallet(process.env.DEMO_PRIVATE_KEY, getDemoProvider());
    _signer = new ethers.NonceManager(wallet);
  }
  return _signer;
}

async function getDemoStatus() {
  if (!process.env.DEMO_PRIVATE_KEY) {
    return { enabled: false };
  }
  const signer = getDemoSigner();
  const address = await signer.getAddress();
  const balanceWei = await getDemoProvider().getBalance(address);
  const balanceEth = Number(ethers.formatEther(balanceWei));
  return {
    enabled: true,
    address,
    balanceEth,
    // A full scenario deploy is ~15-20 transactions; well under 0.02 ETH
    // of Sepolia gas even at generous prices, but flag low balance before
    // it fails mid-deploy (worse UX than failing up front).
    lowBalance: balanceEth < 0.02,
  };
}

async function deployDemoScenario(scenarioId, onStatus = () => {}) {
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) {
    throw new Error(`Unknown scenario id: ${scenarioId}. Known: ${Object.keys(SCENARIOS).join(", ")}`);
  }

  const signer = getDemoSigner();
  const addr = await signer.getAddress();

  onStatus("Deploying WorldRegistry…");
  const RegistryFactory = new ethers.ContractFactory(WorldRegistryABI.abi, WorldRegistryABI.bytecode, signer);
  const registry = await RegistryFactory.deploy(addr);
  await registry.waitForDeployment();

  onStatus("Deploying MetricsOracle…");
  const OracleFactory = new ethers.ContractFactory(MetricsOracleABI.abi, MetricsOracleABI.bytecode, signer);
  const oracle = await OracleFactory.deploy(await registry.getAddress(), addr);
  await oracle.waitForDeployment();

  onStatus("Wiring oracle…");
  await (await registry.setMetricsOracle(await oracle.getAddress())).wait();

  onStatus("Deploying nation factories…");
  const TokenFactoryFactory = new ethers.ContractFactory(CitizenTokenFactoryABI.abi, CitizenTokenFactoryABI.bytecode, signer);
  const tokenFactory = await TokenFactoryFactory.deploy();
  await tokenFactory.waitForDeployment();

  const DaoFactoryFactory = new ethers.ContractFactory(NationDAOFactoryABI.abi, NationDAOFactoryABI.bytecode, signer);
  const daoFactory = await DaoFactoryFactory.deploy();
  await daoFactory.waitForDeployment();

  await (await registry.setNationFactories(await tokenFactory.getAddress(), await daoFactory.getAddress())).wait();

  onStatus("Initializing scenario…");
  await (await registry.initializeScenario(
    scenario.meta.name,
    scenario.meta.version,
    BigInt(scenario.simulation.defaultCycles)
  )).wait();

  // Demo wallet fills every role slot (deployer, guardian, royal, citizen
  // segments) — there's only one signer here, unlike the browser flow
  // where MetaMask/Dev Mode can expose multiple local accounts. Fine for
  // a demo: governance mechanics still run for real, just without
  // distinct human actors behind each veto role.
  const deployedNations = {};
  for (const nation of scenario.nations) {
    onStatus(`Deploying ${nation.name}…`);
    const gov = nation.governance;
    const config = {
      name: nation.name,
      nationId: nation.id,
      governanceType: GovernanceType[gov.type] ?? 0,
      votingMechanism: VotingMechanism[gov.votingMechanism] ?? 0,
      proposalThreshold: BigInt(gov.proposalThreshold),
      quorumPercent: BigInt(gov.quorum),
      votingDelayBlocks: BigInt(1),
      votingPeriodBlocks: BigInt(5),
      timelockBlocks: BigInt(2),
      hasGuardianVeto: gov.guardianVeto || false,
      hasRoyalVeto: gov.royalVeto || false,
      guardianCouncil: gov.guardianVeto ? addr : ethers.ZeroAddress,
      royalAuthority: gov.royalVeto ? addr : ethers.ZeroAddress,
      hardlinerPressure: BigInt(gov.hardlinerPressure || 0),
      reformPressure: BigInt(gov.reformPressure || 0),
    };
    await (await registry.registerNation(
      config,
      BigInt(1_000_000) * BigInt(10 ** 18),
      BigInt(nation.economy.treasury),
      BigInt(nation.military.power)
    )).wait();
    const registered = await registry.getNation(nation.id);
    deployedNations[nation.id] = { dao: registered.daoAddress, token: registered.tokenAddress, name: nation.name };
  }

  onStatus("Distributing citizenship tokens…");
  for (const [nationId, allocations] of Object.entries(scenario.citizenDistribution || {})) {
    const addrs = allocations.map(() => addr); // single demo signer fills every slot
    const amounts = allocations.map((a) => BigInt(a.amount) * BigInt(10 ** 18));
    await (await registry.distributeCitizenship(nationId, addrs, amounts)).wait();
  }

  onStatus("Setting relationships…");
  for (const rel of scenario.relationships) {
    await (await registry.setRelationship(
      rel.from, rel.to,
      RelationshipType[rel.type] ?? RelationshipType.NEUTRAL,
      BigInt(rel.stabilityScore),
      rel.treatyActive, rel.treatyName || ""
    )).wait();
  }

  onStatus("Registering events…");
  for (const evt of scenario.activeEvents) {
    if (evt.type === "PEACE_DEAL" || evt.type === "RESOURCE_EVENT") {
      await (await registry.createGlobalEvent(
        evt.id, evt.name,
        EventType[evt.type] ?? EventType.PEACE_DEAL,
        evt.parties || [], evt.description
      )).wait();
    }
  }

  onStatus("Setting initial metrics…");
  const m = scenario.simulation.metrics;
  await (await oracle.updateMetrics(
    BigInt(m.find((x) => x.id === "stability_index").startingValue),
    BigInt(m.find((x) => x.id === "conflict_events").startingValue),
    BigInt(m.find((x) => x.id === "trade_volume").startingValue),
    BigInt(m.find((x) => x.id === "proxy_activity").startingValue),
    BigInt(m.find((x) => x.id === "deal_integrity").startingValue)
  )).wait();

  await (await registry.startSimulation()).wait();
  onStatus("Deployed.");

  return {
    registryAddress: await registry.getAddress(),
    oracleAddress: await oracle.getAddress(),
    signerAddress: addr,
    nations: deployedNations,
    scenarioId,
    network: "sepolia",
  };
}

module.exports = { getDemoStatus, deployDemoScenario, SCENARIOS };
