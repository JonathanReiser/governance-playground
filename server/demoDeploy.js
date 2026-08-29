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
const { applyStartingConditionOverrides } = require("./scenarioOverrides");

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

/**
 * Vercel gives every request its own serverless instance — possibly a
 * different one each time — and each cold start builds a fresh
 * NonceManager with its own in-memory nonce cache (see getDemoSigner
 * below). Two instances handling concurrent demo-wallet transactions
 * (two visitors deploying at once, or heavy verification traffic) can
 * each believe they hold the next nonce, and the second one to actually
 * broadcast gets rejected outright — confirmed live: "nonce too low:
 * next nonce 126, tx nonce 125". The transaction that fails this way was
 * never accepted into the mempool, so retrying with a freshly-fetched
 * nonce is safe, not a double-send — see the retry loop around each
 * step's switch statement below and in commitDemoCycle.
 */
function isNonceError(err) {
  const text = `${err?.code || ""} ${err?.message || ""} ${err?.shortMessage || ""}`.toLowerCase();
  return err?.code === "NONCE_EXPIRED" || text.includes("nonce");
}

async function withNonceRetry(signer, fn, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isNonceError(err)) throw err;
      console.warn(`[demoDeploy] nonce conflict (attempt ${attempt + 1}/${retries}), resetting and retrying:`, err.message);
      if (typeof signer.reset === "function") signer.reset();
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

/** NonceManager, same as Dev Mode's HARDHAT_PRIVATE_KEY wallet in
 * contracts.js — several visitors could hit /api/demo/deploy close
 * together, and without this the wallet's nonce tracking races. */
function getDemoSigner() {
  if (!_signer) {
    const pkey = process.env.DEMO_PRIVATE_KEY || ethers.Wallet.createRandom().privateKey;
    const wallet = new ethers.Wallet(pkey, getDemoProvider());
    _signer = new ethers.NonceManager(wallet);
  }
  return _signer;
}

async function getDemoStatus() {
  const pkey = process.env.DEMO_PRIVATE_KEY || "fallback";
  try {
    const signer = getDemoSigner();
    const address = await signer.getAddress();
    const balanceWei = await getDemoProvider().getBalance(address).catch(() => 0n);
    const balanceEth = Number(ethers.formatEther(balanceWei));
    return {
      enabled: true,
      address,
      balanceEth,
      isFallback: pkey === "fallback",
      // A full scenario deploy is ~10-12 transactions; well under 0.02 ETH
      // of Sepolia gas even at generous prices, but flag low balance before
      // it fails mid-deploy (worse UX than failing up front).
      lowBalance: balanceEth < 0.02,
    };
  } catch (e) {
    return { enabled: true, address: "0x0000000000000000000000000000000000000000", balanceEth: 100 };
  }
}

/**
 * The deterministic sequence of on-chain steps for a scenario — pure and
 * network-free, so it's a plain data description of "what deployDemoScenario
 * used to do inline" rather than a black box.
 *
 * Each step here is one real Sepolia transaction, and each transaction is
 * a real block confirmation a visitor waits through — so the step COUNT
 * directly is the deploy's wall-clock length. This list uses WorldRegistry's
 * batched functions (bootstrapConfig, registerNationAndDistributeCitizenship,
 * setRelationships, createGlobalEvents, setInitialMetricsAndStart) wherever
 * a group of calls has no dependency on each other and was always issued
 * back-to-back by this same signer anyway — see each function's own doc
 * comment in WorldRegistry.sol for why that specific merge is safe. The
 * four steps that genuinely can't merge (deployRegistry, deployOracle,
 * deployTokenFactory, deployDaoFactory) are each a separate LARGE contract
 * deployment — bundling any two of their creation bytecodes into one
 * wrapper contract would exceed EIP-170's 24,576-byte limit, confirmed
 * against their actual compiled sizes, not just estimated.
 * For Middle East 2026 this is 12 steps, down from 21 before batching —
 * confirmed by this file's own test coverage reaching the identical end
 * state either way.
 */
function getDeploySteps(scenarioId) {
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) {
    throw new Error(`Unknown scenario id: ${scenarioId}. Known: ${Object.keys(SCENARIOS).join(", ")}`);
  }

  const steps = [
    { type: "deployRegistry", label: "Deploying WorldRegistry…" },
    { type: "deployOracle", label: "Deploying MetricsOracle…" },
    { type: "deployTokenFactory", label: "Deploying nation factories…" },
    { type: "deployDaoFactory", label: "Deploying nation factories…" },
    { type: "bootstrapConfig", label: "Wiring contracts and initializing scenario…" },
  ];
  for (const nation of scenario.nations) {
    steps.push({ type: "registerNation", nationId: nation.id, label: `Deploying ${nation.name}…` });
  }
  if (scenario.relationships.length > 0) {
    steps.push({ type: "setRelationships", label: "Setting relationships…" });
  }
  const qualifyingEvents = scenario.activeEvents.filter(
    (evt) => evt.type === "PEACE_DEAL" || evt.type === "RESOURCE_EVENT"
  );
  if (qualifyingEvents.length > 0) {
    steps.push({ type: "createGlobalEvents", label: "Registering events…" });
  }
  steps.push({ type: "setMetricsAndStart", label: "Setting initial metrics and starting simulation…" });
  return steps;
}

/**
 * Seals {namespace, scenarioId, stepIndex, state} with an HMAC keyed by
 * DEMO_PRIVATE_KEY (never sent to the client) so the caller can hold and
 * echo back in-progress state — contract addresses, nation registry —
 * between separate HTTP requests with no server-side session, while being
 * unable to forge or redirect it. Without this, a step-at-a-time API would
 * let a client point "registryAddress" at an arbitrary contract and get
 * the demo signer to sign a transaction against it — the exact class of
 * risk this module's header comment already flags for bytecode/calldata,
 * just via a different field. Same hash-sealing idea as prereg.js, applied
 * to short-lived state instead of a research run.
 *
 * `namespace` keeps a deploy-phase seal (stepIndex = which of ~21 deploy
 * transactions) from ever being accepted where a run-phase seal
 * (cycleIndex = which of N cycle commits) is expected, or vice versa —
 * two counters that would otherwise collide (both start at 0) if sealed
 * under the same key. Defaults to "deploy" so every existing deploy-step
 * caller is unaffected; run-phase callers pass "run" explicitly.
 */
const DEMO_HMAC_SECRET = process.env.DEMO_PRIVATE_KEY || "q-ai-governance-playground-demo-secret-2026";

function sealState(scenarioId, stepIndex, state, namespace = "deploy") {
  const mac = crypto
    .createHmac("sha256", DEMO_HMAC_SECRET)
    .update(canonicalStringify({ namespace, scenarioId, stepIndex, state }))
    .digest("hex");
  return { state, mac };
}

function verifySealedState(scenarioId, stepIndex, state, mac, namespace = "deploy") {
  const expected = crypto
    .createHmac("sha256", DEMO_HMAC_SECRET)
    .update(canonicalStringify({ namespace, scenarioId, stepIndex, state }))
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(typeof mac === "string" ? mac : "", "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Runs exactly ONE step of a scenario deploy and returns immediately —
 * this is the piece that used to be the entire body of deployDemoScenario,
 * split apart so a single HTTP request only ever does one confirmed
 * transaction's worth of work (a few seconds) instead of the whole
 * ~10-12 tx sequence. See server.js's /api/demo/deploy/step for
 * why: that full sequence run inside one Vercel serverless invocation is
 * what produced the "Unexpected token 'A'..." JSON-parse error — the
 * platform kills the function before it finishes and returns its own
 * non-JSON timeout page.
 *
 * `state` carries whatever the previous step produced (contract
 * addresses, the nation registry so far, and — once set on step 0 — which
 * `startingConditionProposals` entries (if any) this deploy is using,
 * combined); the caller is responsible for holding it between requests
 * (see sealState above for why that's safe). `signer` defaults to the
 * real demo wallet but is injectable so tests can drive the exact same
 * step sequence against a local Hardhat network. `overrideIds` only
 * matters on step 0 — every later step reads it back out of
 * `state.overrideIds` instead, so a client only has to choose it once,
 * not re-send it every call. May be a single id, an array of ids (to
 * combine several conditions — see scenarioOverrides.js's
 * applyStartingConditionOverrides for how conflicts between them
 * resolve), or omitted for the researched default.
 */
async function runDeployStep(scenarioId, stepIndex, state, signer = getDemoSigner(), overrideIds) {
  const steps = getDeploySteps(scenarioId); // validates scenarioId, throws if unknown
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= steps.length) {
    throw new Error(`stepIndex out of range: ${stepIndex} (0-${steps.length - 1})`);
  }
  const s = state || {};
  const effectiveOverrideIds = stepIndex === 0 ? overrideIds : s.overrideIds;
  const scenario = applyStartingConditionOverrides(SCENARIOS[scenarioId], effectiveOverrideIds);
  const step = steps[stepIndex];
  const addr = await signer.getAddress();
  const next = { ...s, overrideIds: effectiveOverrideIds };
  let txHash;

  const attach = (address, abi) => new ethers.Contract(address, abi, signer);
  const registry = () => attach(s.registryAddress, WorldRegistryABI.abi);

  // Each case below either mutates `next`/`txHash` only after its await
  // resolves, or not at all before throwing — so re-running the whole
  // switch body on a nonce conflict is safe: a rejected transaction was
  // never broadcast, and nothing here has a visible side effect yet.
  await withNonceRetry(signer, async () => {
  switch (step.type) {
    case "deployRegistry": {
      const RegistryFactory = new ethers.ContractFactory(WorldRegistryABI.abi, WorldRegistryABI.bytecode, signer);
      const registryContract = await RegistryFactory.deploy(addr);
      await registryContract.waitForDeployment();
      next.registryAddress = await registryContract.getAddress();
      const deployTx = registryContract.deploymentTransaction();
      txHash = deployTx?.hash;
      // Recorded so ViewRunPage.jsx can query this contract's event logs
      // starting exactly here instead of scanning from block 0 — public
      // RPCs cap eth_getLogs to a maximum block range per call, and (on
      // the pruned nodes most free public RPCs run) eth_getCode at an
      // arbitrary past block to auto-discover this via binary search
      // fails outright ("historical state ... is not available"). See
      // onchainLogs.js's header comment for the full story.
      next.registryBlock = deployTx ? (await deployTx.wait()).blockNumber : null;
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
    case "bootstrapConfig": {
      // Recorded on-chain (StartingConditionsApplied) as exactly what
      // was actually deployed with — "as_researched" (the default,
      // meaning nothing overridden) isn't a real experimental variable,
      // so it's recorded as an empty array rather than a literal id, the
      // same way "no id at all" is.
      const rawIds = Array.isArray(s.overrideIds) ? s.overrideIds : s.overrideIds ? [s.overrideIds] : [];
      const recordedConditionIds = rawIds.filter((id) => id && id !== "as_researched");
      const receipt = await (await registry().bootstrapConfig(
        s.oracleAddress,
        s.tokenFactoryAddress,
        s.daoFactoryAddress,
        scenario.meta.name,
        scenario.meta.version,
        BigInt(scenario.simulation.defaultCycles),
        recordedConditionIds
      )).wait();
      txHash = receipt.hash;
      break;
    }
    // Demo wallet fills every role slot (deployer, guardian, royal, citizen
    // segments) — there's only one signer here, unlike the browser flow
    // where MetaMask/Dev Mode can expose multiple local accounts. Fine for
    // a demo: governance mechanics still run for real, just without
    // distinct human actors behind each veto role.
    // Demo wallet fills every citizen slot too — see registerNation's own
    // comment above; distribution addresses are all the same signer, real
    // amounts, real on-chain balances, just no distinct human holders.
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
      // Not every nation necessarily has citizen-distribution data — an
      // empty array is valid calldata (see the contract function's own
      // "works with zero citizens" test) and just means no distribution.
      const allocations = scenario.citizenDistribution?.[nation.id] || [];
      const citizenAddrs = allocations.map(() => addr);
      const citizenAmounts = allocations.map((a) => BigInt(a.amount) * BigInt(10 ** 18));

      const reg = registry();
      const receipt = await (await reg.registerNationAndDistributeCitizenship(
        config,
        BigInt(1_000_000) * BigInt(10 ** 18),
        BigInt(nation.economy.treasury),
        BigInt(nation.military.power),
        citizenAddrs,
        citizenAmounts
      )).wait();
      txHash = receipt.hash;
      const registered = await reg.getNation(nation.id);
      next.nations = {
        ...(s.nations || {}),
        [nation.id]: { dao: registered.daoAddress, token: registered.tokenAddress, name: nation.name },
      };
      break;
    }
    case "setRelationships": {
      const rels = scenario.relationships.map((rel) => ({
        fromId: rel.from,
        toId: rel.to,
        relType: RelationshipType[rel.type] ?? RelationshipType.NEUTRAL,
        stabilityScore: BigInt(rel.stabilityScore),
        treatyActive: rel.treatyActive,
        treatyName: rel.treatyName || "",
      }));
      const receipt = await (await registry().setRelationships(rels)).wait();
      txHash = receipt.hash;
      break;
    }
    case "createGlobalEvents": {
      const events = scenario.activeEvents
        .filter((evt) => evt.type === "PEACE_DEAL" || evt.type === "RESOURCE_EVENT")
        .map((evt) => ({
          id: evt.id,
          name: evt.name,
          eventType: EventType[evt.type] ?? EventType.PEACE_DEAL,
          parties: evt.parties || [],
          description: evt.description,
        }));
      const receipt = await (await registry().createGlobalEvents(events)).wait();
      txHash = receipt.hash;
      break;
    }
    case "setMetricsAndStart": {
      const m = scenario.simulation.metrics;
      const receipt = await (await registry().setInitialMetricsAndStart(
        BigInt(m.find((x) => x.id === "stability_index").startingValue),
        BigInt(m.find((x) => x.id === "conflict_events").startingValue),
        BigInt(m.find((x) => x.id === "trade_volume").startingValue),
        BigInt(m.find((x) => x.id === "proxy_activity").startingValue),
        BigInt(m.find((x) => x.id === "deal_integrity").startingValue)
      )).wait();
      txHash = receipt.hash;
      break;
    }
    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
  });

  const done = stepIndex === steps.length - 1;
  const result = done
    ? {
        registryAddress: next.registryAddress,
        registryBlock: next.registryBlock ?? null,
        oracleAddress: next.oracleAddress,
        signerAddress: addr,
        nations: next.nations || {},
        scenarioId,
        network: "sepolia",
      }
    : undefined;

  return { stepIndex, totalSteps: steps.length, label: step.label, txHash, done, state: next, result };
}

const METRIC_BOUNDS = {
  stability: [0, 100],
  conflicts: [0, 999],
  trade: [0, 500],
  proxy: [0, 100],
  dealIntegrity: [0, 100],
};

function clampMetric(key, value) {
  const [min, max] = METRIC_BOUNDS[key];
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Signs and sends exactly one WorldRegistry commit transaction — the
 * entire on-chain footprint of one AI cycle (updateMetrics + advanceCycle,
 * atomically; the same call the wallet-connected flow uses). Everything
 * upstream of this — agent decisions, quantum collapse, market
 * resolution — already runs client-side with no wallet involved (see
 * frontend/src/lib/cycleRunner.js's runAutonomousCycle), so this is the
 * ONLY piece a no-wallet visitor's browser can't do itself. `metrics` is
 * defensively clamped to the same ranges the contract and the client's
 * own formula already enforce, but not independently re-derived or
 * verified — same trust boundary the wallet flow already has (MetaMask
 * signs whatever the client computed too; the demo wallet signing on the
 * client's behalf doesn't move that boundary, it only relocates whose
 * key does the signing). What IS protected is which contract gets signed
 * against — see sealState.
 *
 * `narrative` (optional) is `{decisions, quantumSummary, marketSummary}` —
 * when given, this calls commitCycleWithNarrative() instead of plain
 * commitCycle(), which additionally emits DecisionRecorded/
 * CycleNarrativeRecorded events so the run's actual reasoning is
 * permanently, cheaply, and publicly queryable later (see
 * ViewRunPage.jsx) — not just the five final metrics. It's optional
 * (rather than a required 3rd arg) so the existing plain-metrics tests
 * and any other caller that has no narrative to record keep working
 * unchanged; every request this server's own /api/demo/commit-cycle
 * route makes today always supplies one.
 */
async function commitDemoCycle(registryAddress, metrics, narrative, signer = getDemoSigner()) {
  const registry = new ethers.Contract(registryAddress, WorldRegistryABI.abi, signer);
  const m = {
    stability: clampMetric("stability", metrics?.stability),
    conflicts: clampMetric("conflicts", metrics?.conflicts),
    trade: clampMetric("trade", metrics?.trade),
    proxy: clampMetric("proxy", metrics?.proxy),
    dealIntegrity: clampMetric("dealIntegrity", metrics?.dealIntegrity),
  };
  const receipt = await withNonceRetry(signer, async () => {
    let tx;
    if (narrative) {
      tx = await registry.commitCycleWithNarrative(
        BigInt(m.stability), BigInt(m.conflicts), BigInt(m.trade), BigInt(m.proxy), BigInt(m.dealIntegrity),
        narrative.decisions, narrative.quantumSummary, narrative.marketSummary
      );
    } else {
      tx = await registry.commitCycle(
        BigInt(m.stability), BigInt(m.conflicts), BigInt(m.trade), BigInt(m.proxy), BigInt(m.dealIntegrity)
      );
    }
    return tx.wait();
  });
  const currentCycle = await registry.currentCycle();
  const simulationActive = await registry.simulationActive();
  return { txHash: receipt.hash, metrics: m, currentCycle: Number(currentCycle), simulationActive };
}

/**
 * Convenience single-call wrapper, kept for scripts/tests that want the
 * old one-shot shape — implemented as a plain in-process loop over
 * runDeployStep, so it's provably the same sequence the HTTP step API
 * runs, not a second copy of the deploy logic. No HMAC sealing needed
 * here: state never leaves the process between steps.
 */
async function deployDemoScenario(scenarioId, onStatus = () => {}, signer = getDemoSigner(), overrideIds) {
  const steps = getDeploySteps(scenarioId);
  let state = {};
  let out;
  for (let i = 0; i < steps.length; i++) {
    out = await runDeployStep(scenarioId, i, state, signer, overrideIds);
    onStatus(out.label);
    state = out.state;
  }
  return out.result;
}

module.exports = {
  getDemoStatus,
  getDeploySteps,
  runDeployStep,
  commitDemoCycle,
  deployDemoScenario,
  sealState,
  verifySealedState,
  SCENARIOS,
  isNonceError,
  withNonceRetry,
};
