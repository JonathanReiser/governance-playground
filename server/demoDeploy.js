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

const crypto = require("crypto");
const { ethers } = require("ethers");
const { canonicalStringify } = require("./prereg");

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

/**
 * The deterministic sequence of on-chain steps for a scenario — pure and
 * network-free, so it's a plain data description of "what deployDemoScenario
 * used to do inline" rather than a black box. Same order as the original
 * one-shot function; nothing reordered, nothing added or dropped.
 */
function getDeploySteps(scenarioId) {
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) {
    throw new Error(`Unknown scenario id: ${scenarioId}. Known: ${Object.keys(SCENARIOS).join(", ")}`);
  }

  const steps = [
    { type: "deployRegistry", label: "Deploying WorldRegistry…" },
    { type: "deployOracle", label: "Deploying MetricsOracle…" },
    { type: "wireOracle", label: "Wiring oracle…" },
    { type: "deployTokenFactory", label: "Deploying nation factories…" },
    { type: "deployDaoFactory", label: "Deploying nation factories…" },
    { type: "wireFactories", label: "Wiring nation factories…" },
    { type: "initScenario", label: "Initializing scenario…" },
  ];
  for (const nation of scenario.nations) {
    steps.push({ type: "registerNation", nationId: nation.id, label: `Deploying ${nation.name}…` });
  }
  for (const nationId of Object.keys(scenario.citizenDistribution || {})) {
    steps.push({ type: "distributeCitizenship", nationId, label: "Distributing citizenship tokens…" });
  }
  scenario.relationships.forEach((_rel, index) => {
    steps.push({ type: "setRelationship", index, label: "Setting relationships…" });
  });
  scenario.activeEvents.forEach((evt, index) => {
    if (evt.type === "PEACE_DEAL" || evt.type === "RESOURCE_EVENT") {
      steps.push({ type: "registerEvent", index, label: "Registering events…" });
    }
  });
  steps.push({ type: "setMetrics", label: "Setting initial metrics…" });
  steps.push({ type: "startSimulation", label: "Starting simulation…" });
  return steps;
}

/**
 * Seals {scenarioId, stepIndex, state} with an HMAC keyed by
 * DEMO_PRIVATE_KEY (never sent to the client) so the caller can hold and
 * echo back deploy-in-progress state — contract addresses, nation registry
 * — between separate HTTP requests with no server-side session, while
 * being unable to forge or redirect it. Without this, a step-at-a-time API
 * would let a client point "registryAddress" at an arbitrary contract and
 * get the demo signer to sign a transaction against it — the exact class
 * of risk this module's header comment already flags for bytecode/calldata,
 * just via a different field. Same hash-sealing idea as prereg.js, applied
 * to short-lived deploy state instead of a research run.
 */
function sealState(scenarioId, stepIndex, state) {
  const mac = crypto
    .createHmac("sha256", process.env.DEMO_PRIVATE_KEY || "")
    .update(canonicalStringify({ scenarioId, stepIndex, state }))
    .digest("hex");
  return { state, mac };
}

function verifySealedState(scenarioId, stepIndex, state, mac) {
  if (!process.env.DEMO_PRIVATE_KEY) return false;
  const expected = crypto
    .createHmac("sha256", process.env.DEMO_PRIVATE_KEY)
    .update(canonicalStringify({ scenarioId, stepIndex, state }))
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(typeof mac === "string" ? mac : "", "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Runs exactly ONE step of a scenario deploy and returns immediately —
 * this is the piece that used to be the entire body of deployDemoScenario,
 * split apart so a single HTTP request only ever does one confirmed
 * transaction's worth of work (a few seconds) instead of the whole ~15-20
 * tx, several-minute sequence. See server.js's /api/demo/deploy/step for
 * why: that full sequence run inside one Vercel serverless invocation is
 * what produced the "Unexpected token 'A'..." JSON-parse error — the
 * platform kills the function before it finishes and returns its own
 * non-JSON timeout page.
 *
 * `state` carries whatever the previous step produced (contract
 * addresses, the nation registry so far); the caller is responsible for
 * holding it between requests (see sealState above for why that's safe).
 * `signer` defaults to the real demo wallet but is injectable so tests can
 * drive the exact same step sequence against a local Hardhat network.
 */
async function runDeployStep(scenarioId, stepIndex, state, signer = getDemoSigner()) {
  const scenario = SCENARIOS[scenarioId];
  const steps = getDeploySteps(scenarioId);
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= steps.length) {
    throw new Error(`stepIndex out of range: ${stepIndex} (0-${steps.length - 1})`);
  }
  const step = steps[stepIndex];
  const addr = await signer.getAddress();
  const s = state || {};
  const next = { ...s };
  let txHash;

  const attach = (address, abi) => new ethers.Contract(address, abi, signer);
  const registry = () => attach(s.registryAddress, WorldRegistryABI.abi);
  const oracle = () => attach(s.oracleAddress, MetricsOracleABI.abi);

  switch (step.type) {
    case "deployRegistry": {
      const RegistryFactory = new ethers.ContractFactory(WorldRegistryABI.abi, WorldRegistryABI.bytecode, signer);
      const registryContract = await RegistryFactory.deploy(addr);
      await registryContract.waitForDeployment();
      next.registryAddress = await registryContract.getAddress();
      txHash = registryContract.deploymentTransaction()?.hash;
      break;
    }
    case "deployOracle": {
      const OracleFactory = new ethers.ContractFactory(MetricsOracleABI.abi, MetricsOracleABI.bytecode, signer);
      const oracleContract = await OracleFactory.deploy(s.registryAddress, addr);
      await oracleContract.waitForDeployment();
      next.oracleAddress = await oracleContract.getAddress();
      txHash = oracleContract.deploymentTransaction()?.hash;
      break;
    }
    case "wireOracle": {
      const receipt = await (await registry().setMetricsOracle(s.oracleAddress)).wait();
      txHash = receipt.hash;
      break;
    }
    case "deployTokenFactory": {
      const TokenFactoryFactory = new ethers.ContractFactory(CitizenTokenFactoryABI.abi, CitizenTokenFactoryABI.bytecode, signer);
      const tokenFactory = await TokenFactoryFactory.deploy();
      await tokenFactory.waitForDeployment();
      next.tokenFactoryAddress = await tokenFactory.getAddress();
      txHash = tokenFactory.deploymentTransaction()?.hash;
      break;
    }
    case "deployDaoFactory": {
      const DaoFactoryFactory = new ethers.ContractFactory(NationDAOFactoryABI.abi, NationDAOFactoryABI.bytecode, signer);
      const daoFactory = await DaoFactoryFactory.deploy();
      await daoFactory.waitForDeployment();
      next.daoFactoryAddress = await daoFactory.getAddress();
      txHash = daoFactory.deploymentTransaction()?.hash;
      break;
    }
    case "wireFactories": {
      const receipt = await (await registry().setNationFactories(s.tokenFactoryAddress, s.daoFactoryAddress)).wait();
      txHash = receipt.hash;
      break;
    }
    case "initScenario": {
      const receipt = await (await registry().initializeScenario(
        scenario.meta.name,
        scenario.meta.version,
        BigInt(scenario.simulation.defaultCycles)
      )).wait();
      txHash = receipt.hash;
      break;
    }
    // Demo wallet fills every role slot (deployer, guardian, royal, citizen
    // segments) — there's only one signer here, unlike the browser flow
    // where MetaMask/Dev Mode can expose multiple local accounts. Fine for
    // a demo: governance mechanics still run for real, just without
    // distinct human actors behind each veto role.
    case "registerNation": {
      const nation = scenario.nations.find((n) => n.id === step.nationId);
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
      const reg = registry();
      const receipt = await (await reg.registerNation(
        config,
        BigInt(1_000_000) * BigInt(10 ** 18),
        BigInt(nation.economy.treasury),
        BigInt(nation.military.power)
      )).wait();
      txHash = receipt.hash;
      const registered = await reg.getNation(nation.id);
      next.nations = {
        ...(s.nations || {}),
        [nation.id]: { dao: registered.daoAddress, token: registered.tokenAddress, name: nation.name },
      };
      break;
    }
    case "distributeCitizenship": {
      const allocations = scenario.citizenDistribution[step.nationId];
      const addrs = allocations.map(() => addr); // single demo signer fills every slot
      const amounts = allocations.map((a) => BigInt(a.amount) * BigInt(10 ** 18));
      const receipt = await (await registry().distributeCitizenship(step.nationId, addrs, amounts)).wait();
      txHash = receipt.hash;
      break;
    }
    case "setRelationship": {
      const rel = scenario.relationships[step.index];
      const receipt = await (await registry().setRelationship(
        rel.from, rel.to,
        RelationshipType[rel.type] ?? RelationshipType.NEUTRAL,
        BigInt(rel.stabilityScore),
        rel.treatyActive, rel.treatyName || ""
      )).wait();
      txHash = receipt.hash;
      break;
    }
    case "registerEvent": {
      const evt = scenario.activeEvents[step.index];
      const receipt = await (await registry().createGlobalEvent(
        evt.id, evt.name,
        EventType[evt.type] ?? EventType.PEACE_DEAL,
        evt.parties || [], evt.description
      )).wait();
      txHash = receipt.hash;
      break;
    }
    case "setMetrics": {
      const m = scenario.simulation.metrics;
      const receipt = await (await oracle().updateMetrics(
        BigInt(m.find((x) => x.id === "stability_index").startingValue),
        BigInt(m.find((x) => x.id === "conflict_events").startingValue),
        BigInt(m.find((x) => x.id === "trade_volume").startingValue),
        BigInt(m.find((x) => x.id === "proxy_activity").startingValue),
        BigInt(m.find((x) => x.id === "deal_integrity").startingValue)
      )).wait();
      txHash = receipt.hash;
      break;
    }
    case "startSimulation": {
      const receipt = await (await registry().startSimulation()).wait();
      txHash = receipt.hash;
      break;
    }
    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }

  const done = stepIndex === steps.length - 1;
  const result = done
    ? {
        registryAddress: next.registryAddress,
        oracleAddress: next.oracleAddress,
        signerAddress: addr,
        nations: next.nations || {},
        scenarioId,
        network: "sepolia",
      }
    : undefined;

  return { stepIndex, totalSteps: steps.length, label: step.label, txHash, done, state: next, result };
}

/**
 * Convenience single-call wrapper, kept for scripts/tests that want the
 * old one-shot shape — implemented as a plain in-process loop over
 * runDeployStep, so it's provably the same sequence the HTTP step API
 * runs, not a second copy of the deploy logic. No HMAC sealing needed
 * here: state never leaves the process between steps.
 */
async function deployDemoScenario(scenarioId, onStatus = () => {}, signer = getDemoSigner()) {
  const steps = getDeploySteps(scenarioId);
  let state = {};
  let out;
  for (let i = 0; i < steps.length; i++) {
    out = await runDeployStep(scenarioId, i, state, signer);
    onStatus(out.label);
    state = out.state;
  }
  return out.result;
}

module.exports = {
  getDemoStatus,
  getDeploySteps,
  runDeployStep,
  deployDemoScenario,
  sealState,
  verifySealedState,
  SCENARIOS,
};
