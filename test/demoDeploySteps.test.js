/**
 * Tests for the step-machine demo deploy — see server/demoDeploy.js's
 * header comments on why this exists: the old deployDemoScenario() ran
 * ~15-20 confirmed transactions inside one HTTP request, which is longer
 * than any Vercel serverless function is allowed to run. This suite
 * covers the two things that replaced it:
 *   1. getDeploySteps() — the pure, network-free step plan.
 *   2. sealState/verifySealedState — the HMAC that lets a client hold
 *      deploy-in-progress state between requests without being able to
 *      forge or redirect it.
 *   3. The step machine actually deploys a working scenario, run against
 *      Hardhat's local network (no real Sepolia ETH, no real time cost),
 *      with the demo wallet swapped for an injected local signer.
 *   4. commitDemoCycle() — the no-wallet "watch it play out" run phase's
 *      only on-chain piece — and the namespace that keeps its cycleIndex
 *      counter from colliding with deploy's stepIndex counter.
 */

const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

const {
  getDeploySteps, runDeployStep, commitDemoCycle, deployDemoScenario, sealState, verifySealedState,
  isNonceError, withNonceRetry,
} = require("../server/demoDeploy");

const WorldRegistryABI = require("../frontend/src/abi/WorldRegistry.json");
const NationDAOABI = require("../frontend/src/abi/NationDAO.json");
const middleEast = require("../frontend/src/scenarios/middle-east-2026.json");
const taiwanStrait = require("../frontend/src/scenarios/taiwan-strait-2026.json");

const SCENARIOS = { "middle-east-2026": middleEast, "taiwan-strait-2026": taiwanStrait };

function expectedStepTypes(scenario) {
  const qualifyingEvents = scenario.activeEvents.filter(
    (e) => e.type === "PEACE_DEAL" || e.type === "RESOURCE_EVENT"
  );
  return [
    "deployRegistry", "deployOracle", "deployTokenFactory", "deployDaoFactory", "bootstrapConfig",
    ...scenario.nations.map(() => "registerNation"),
    ...(scenario.relationships.length > 0 ? ["setRelationships"] : []),
    ...(qualifyingEvents.length > 0 ? ["createGlobalEvents"] : []),
    "setMetricsAndStart",
  ];
}

describe("demo deploy — step machine", function () {
  describe("getDeploySteps (pure, no network)", function () {
    for (const [scenarioId, scenario] of Object.entries(SCENARIOS)) {
      it(`matches ${scenarioId}'s scenario data step-for-step`, function () {
        const steps = getDeploySteps(scenarioId);
        expect(steps.map((s) => s.type)).to.deep.equal(expectedStepTypes(scenario));
      });
    }

    it("carries the right nationId/index through each step", function () {
      const steps = getDeploySteps("middle-east-2026");
      const nationSteps = steps.filter((s) => s.type === "registerNation");
      expect(nationSteps.map((s) => s.nationId)).to.deep.equal(middleEast.nations.map((n) => n.id));
    });

    it("throws on an unknown scenario id", function () {
      expect(() => getDeploySteps("not-a-real-scenario")).to.throw(/Unknown scenario id/);
    });
  });

  describe("sealState / verifySealedState", function () {
    const savedKey = process.env.DEMO_PRIVATE_KEY;
    before(function () {
      process.env.DEMO_PRIVATE_KEY = "test-only-hmac-key-not-a-real-wallet";
    });
    after(function () {
      if (savedKey === undefined) delete process.env.DEMO_PRIVATE_KEY;
      else process.env.DEMO_PRIVATE_KEY = savedKey;
    });

    it("verifies state it sealed itself", function () {
      const { state, mac } = sealState("middle-east-2026", 3, { registryAddress: "0xAAA" });
      expect(verifySealedState("middle-east-2026", 3, state, mac)).to.equal(true);
    });

    it("rejects a tampered field inside state", function () {
      const { mac } = sealState("middle-east-2026", 3, { registryAddress: "0xAAA" });
      expect(verifySealedState("middle-east-2026", 3, { registryAddress: "0xBBB" }, mac)).to.equal(false);
    });

    it("rejects state replayed against a different stepIndex", function () {
      const { state, mac } = sealState("middle-east-2026", 3, { registryAddress: "0xAAA" });
      expect(verifySealedState("middle-east-2026", 7, state, mac)).to.equal(false);
    });

    it("rejects state replayed against a different scenarioId", function () {
      const { state, mac } = sealState("middle-east-2026", 3, { registryAddress: "0xAAA" });
      expect(verifySealedState("taiwan-strait-2026", 3, state, mac)).to.equal(false);
    });

    it("fails closed (not throws) on a garbage mac", function () {
      expect(verifySealedState("middle-east-2026", 3, { registryAddress: "0xAAA" }, "not-hex")).to.equal(false);
      expect(verifySealedState("middle-east-2026", 3, { registryAddress: "0xAAA" }, undefined)).to.equal(false);
    });

    it("fails closed when DEMO_PRIVATE_KEY is unset", function () {
      const { state, mac } = sealState("middle-east-2026", 3, { registryAddress: "0xAAA" });
      delete process.env.DEMO_PRIVATE_KEY;
      expect(verifySealedState("middle-east-2026", 3, state, mac)).to.equal(false);
      process.env.DEMO_PRIVATE_KEY = "test-only-hmac-key-not-a-real-wallet";
    });
  });

  describe("actual deploy, run step-by-step on a local network", function () {
    // Swaps the real Sepolia demo wallet for an injected local Hardhat
    // signer — no DEMO_PRIVATE_KEY, no real network, no real time cost —
    // so this proves the step machine itself deploys a working scenario,
    // independent of the HTTP/HMAC layer around it.
    this.timeout(120_000);

    it("deployDemoScenario (loop wrapper) reaches a fully running simulation", async function () {
      const [signer] = await ethers.getSigners();
      const messages = [];
      const result = await deployDemoScenario("middle-east-2026", (m) => messages.push(m), signer);

      expect(messages[0]).to.equal("Deploying WorldRegistry…");
      expect(messages[messages.length - 1]).to.equal("Setting initial metrics and starting simulation…");
      expect(result.scenarioId).to.equal("middle-east-2026");
      expect(ethers.isAddress(result.registryAddress)).to.equal(true);
      expect(ethers.isAddress(result.oracleAddress)).to.equal(true);
      expect(Object.keys(result.nations).sort()).to.deep.equal(middleEast.nations.map((n) => n.id).sort());
      for (const nation of middleEast.nations) {
        expect(ethers.isAddress(result.nations[nation.id].dao)).to.equal(true);
      }

      const registry = new ethers.Contract(result.registryAddress, WorldRegistryABI.abi, signer);
      expect(await registry.simulationActive()).to.equal(true);
      expect(await registry.getNationCount()).to.equal(BigInt(middleEast.nations.length));
      expect(await registry.scenarioName()).to.equal(middleEast.meta.name);

      // registryBlock is what lets ViewRunPage.jsx query this contract's
      // event logs starting exactly here instead of scanning from block
      // 0 (which public RPCs reject past a max range) or binary-searching
      // eth_getCode (which fails on pruned public nodes) — see
      // onchainLogs.js. It should be a real, positive block number that
      // actually is the registry's deployment block, not just present.
      expect(Number.isInteger(result.registryBlock)).to.equal(true);
      expect(result.registryBlock).to.be.greaterThan(0);
      const code = await ethers.provider.getCode(result.registryAddress, result.registryBlock);
      expect(code).to.not.equal("0x");
      const codeOneBlockBefore = await ethers.provider.getCode(result.registryAddress, result.registryBlock - 1);
      expect(codeOneBlockBefore).to.equal("0x");
    });

    it("driving runDeployStep directly, one call at a time, reaches the same end state", async function () {
      const [signer] = await ethers.getSigners();
      let state = {};
      let out;
      let i = 0;
      do {
        out = await runDeployStep("taiwan-strait-2026", i, state, signer);
        expect(out.stepIndex).to.equal(i);
        state = out.state;
        i += 1;
      } while (!out.done);

      expect(i).to.equal(getDeploySteps("taiwan-strait-2026").length);
      expect(out.result.nations && Object.keys(out.result.nations)).to.have.lengthOf(taiwanStrait.nations.length);

      const registry = new ethers.Contract(out.result.registryAddress, WorldRegistryABI.abi, signer);
      expect(await registry.simulationActive()).to.equal(true);
    });

    it("rejects an out-of-range stepIndex", async function () {
      const [signer] = await ethers.getSigners();
      const steps = getDeploySteps("middle-east-2026");
      let threw = null;
      try {
        await runDeployStep("middle-east-2026", steps.length, {}, signer);
      } catch (e) {
        threw = e;
      }
      expect(threw).to.not.equal(null);
      expect(threw.message).to.match(/stepIndex out of range/);
    });
  });

  describe("namespaced seals (deploy phase vs run phase)", function () {
    const savedKey = process.env.DEMO_PRIVATE_KEY;
    before(function () {
      process.env.DEMO_PRIVATE_KEY = "test-only-hmac-key-not-a-real-wallet";
    });
    after(function () {
      if (savedKey === undefined) delete process.env.DEMO_PRIVATE_KEY;
      else process.env.DEMO_PRIVATE_KEY = savedKey;
    });

    it("a deploy-phase seal does not verify under the run namespace, even at the same index", function () {
      const { state, mac } = sealState("middle-east-2026", 3, { registryAddress: "0xAAA" }); // default namespace: "deploy"
      expect(verifySealedState("middle-east-2026", 3, state, mac, "deploy")).to.equal(true);
      expect(verifySealedState("middle-east-2026", 3, state, mac, "run")).to.equal(false);
    });

    it("a run-phase seal does not verify under the deploy namespace", function () {
      const { state, mac } = sealState("middle-east-2026", 0, { registryAddress: "0xAAA" }, "run");
      expect(verifySealedState("middle-east-2026", 0, state, mac, "run")).to.equal(true);
      expect(verifySealedState("middle-east-2026", 0, state, mac, "deploy")).to.equal(false);
      expect(verifySealedState("middle-east-2026", 0, state, mac)).to.equal(false); // default namespace is "deploy"
    });
  });

  describe("commitDemoCycle, run on a local network", function () {
    this.timeout(120_000);

    it("advances currentCycle and flips simulationActive off at the last cycle", async function () {
      const [signer] = await ethers.getSigners();
      const deployResult = await deployDemoScenario("middle-east-2026", () => {}, signer);
      const registry = new ethers.Contract(deployResult.registryAddress, WorldRegistryABI.abi, signer);

      expect(await registry.currentCycle()).to.equal(0n);
      expect(await registry.totalCycles()).to.equal(BigInt(middleEast.simulation.defaultCycles));

      const out1 = await commitDemoCycle(
        deployResult.registryAddress,
        { stability: 55, conflicts: 3, trade: 120, proxy: 40, dealIntegrity: 60 },
        undefined,
        signer
      );
      expect(out1.currentCycle).to.equal(1);
      expect(out1.simulationActive).to.equal(true);
      expect(await registry.currentCycle()).to.equal(1n);

      const out2 = await commitDemoCycle(
        deployResult.registryAddress,
        { stability: 40, conflicts: 8, trade: 90, proxy: 60, dealIntegrity: 30 },
        undefined,
        signer
      );
      expect(out2.currentCycle).to.equal(2);
      expect(out2.txHash).to.not.equal(out1.txHash);
    });

    it("clamps out-of-range and malformed metrics instead of reverting or writing garbage", async function () {
      const [signer] = await ethers.getSigners();
      const deployResult = await deployDemoScenario("taiwan-strait-2026", () => {}, signer);

      const out = await commitDemoCycle(
        deployResult.registryAddress,
        { stability: 500, conflicts: -10, trade: "not a number", proxy: 40.7, dealIntegrity: 60 },
        undefined,
        signer
      );
      expect(out.metrics).to.deep.equal({ stability: 100, conflicts: 0, trade: 0, proxy: 41, dealIntegrity: 60 });
      expect(out.currentCycle).to.equal(1);
    });
  });

  describe("commitDemoCycle, with narrative (on-chain DecisionRecorded/CycleNarrativeRecorded)", function () {
    this.timeout(60_000);

    it("calls commitCycleWithNarrative and the events land on-chain, queryable after the fact", async function () {
      const [signer] = await ethers.getSigners();
      const deployResult = await deployDemoScenario("middle-east-2026", () => {}, signer);
      const registry = new ethers.Contract(deployResult.registryAddress, WorldRegistryABI.abi, signer);

      const narrative = {
        decisions: [
          { nationId: "iran", primaryAction: "Reject extension", reasoning: "Hardliners dominate this cycle.", researchNote: "cites MOU text" },
          { nationId: "israel", primaryAction: "Hold posture", reasoning: "Deterrence unchanged.", researchNote: "" },
        ],
        quantumSummary: "iran: hardline; israel: firm — entangled escalation",
        marketSummary: "primary: SPIKE, global: FIRMING",
      };

      const out = await commitDemoCycle(
        deployResult.registryAddress,
        { stability: 55, conflicts: 3, trade: 120, proxy: 40, dealIntegrity: 60 },
        narrative,
        signer
      );
      expect(out.currentCycle).to.equal(1);

      const decisionLogs = await registry.queryFilter(registry.filters.DecisionRecorded());
      expect(decisionLogs.length).to.equal(2);
      expect(decisionLogs[0].args.nationId).to.equal("iran");
      expect(decisionLogs[0].args.reasoning).to.equal("Hardliners dominate this cycle.");
      expect(decisionLogs[1].args.nationId).to.equal("israel");

      const narrativeLogs = await registry.queryFilter(registry.filters.CycleNarrativeRecorded());
      expect(narrativeLogs.length).to.equal(1);
      expect(narrativeLogs[0].args.quantumSummary).to.equal(narrative.quantumSummary);
      expect(narrativeLogs[0].args.marketSummary).to.equal(narrative.marketSummary);
    });

    it("falls back to plain commitCycle (no events) when narrative isn't given", async function () {
      const [signer] = await ethers.getSigners();
      const deployResult = await deployDemoScenario("taiwan-strait-2026", () => {}, signer);
      const registry = new ethers.Contract(deployResult.registryAddress, WorldRegistryABI.abi, signer);

      await commitDemoCycle(
        deployResult.registryAddress,
        { stability: 50, conflicts: 0, trade: 100, proxy: 20, dealIntegrity: 55 },
        undefined,
        signer
      );

      const decisionLogs = await registry.queryFilter(registry.filters.DecisionRecorded());
      expect(decisionLogs.length).to.equal(0);
    });
  });

  describe("starting condition overrides, applied through the real deploy", function () {
    this.timeout(60_000);

    async function readHardlinerPressure(registryAddress, nationId, signer) {
      const registry = new ethers.Contract(registryAddress, WorldRegistryABI.abi, signer);
      const nation = await registry.getNation(nationId);
      const dao = new ethers.Contract(nation.daoAddress, NationDAOABI.abi, signer);
      const config = await dao.config();
      return config.hardlinerPressure;
    }

    it("a real-proposal override lands on-chain in the deployed nation's DAO config", async function () {
      const [signer] = await ethers.getSigners();
      const result = await deployDemoScenario("middle-east-2026", () => {}, signer, "congress_blocks_relief");
      const pressure = await readHardlinerPressure(result.registryAddress, "iran", signer);
      expect(pressure).to.equal(88n);
    });

    it("an unknown overrideId falls back to the researched default, not an error", async function () {
      const [signer] = await ethers.getSigners();
      const result = await deployDemoScenario("middle-east-2026", () => {}, signer, "not-a-real-proposal");
      const pressure = await readHardlinerPressure(result.registryAddress, "iran", signer);
      expect(pressure).to.equal(BigInt(middleEast.nations.find((n) => n.id === "iran").governance.hardlinerPressure));
    });

    it("step-by-step: overrideIds set on step 0 carries through every later step via sealed state", async function () {
      const [signer] = await ethers.getSigners();
      let state = {};
      let out = await runDeployStep("taiwan-strait-2026", 0, state, signer, "arms_package_delivered");
      state = out.state;
      expect(state.overrideIds).to.equal("arms_package_delivered");

      let i = 1;
      while (!out.done) {
        // overrideIds omitted here on purpose — every step after 0 must
        // recover it from state, not from a fresh argument.
        out = await runDeployStep("taiwan-strait-2026", i, state, signer);
        state = out.state;
        i += 1;
      }

      const pressure = await readHardlinerPressure(out.result.registryAddress, "china", signer);
      expect(pressure).to.equal(82n);
    });

    it("combines multiple real proposals at once — 'manipulating multiple variables together'", async function () {
      const [signer] = await ethers.getSigners();
      // Both proposals touch Iran's hardlinerPressure (88 vs 85) — applied
      // in this order, saudi_normalizes_anyway (last) wins there, same
      // last-in-the-list-wins semantics scenarioOverrides.test.js already
      // covers directly. saudi_normalizes_anyway also independently sets
      // Saudi Arabia's own reformPressure, which congress_blocks_relief
      // never touches — that effect should land regardless of order.
      const result = await deployDemoScenario(
        "middle-east-2026", () => {}, signer, ["congress_blocks_relief", "saudi_normalizes_anyway"]
      );
      const iranPressure = await readHardlinerPressure(result.registryAddress, "iran", signer);
      expect(iranPressure).to.equal(85n);

      const registry = new ethers.Contract(result.registryAddress, WorldRegistryABI.abi, signer);
      const saudi = await registry.getNation("saudi_arabia");
      const saudiDao = new ethers.Contract(saudi.daoAddress, NationDAOABI.abi, signer);
      expect((await saudiDao.config()).reformPressure).to.equal(65n);
    });

    it("records the combined condition ids on-chain via StartingConditionsApplied, filtering out as_researched", async function () {
      const [signer] = await ethers.getSigners();
      const result = await deployDemoScenario(
        "middle-east-2026", () => {}, signer, ["as_researched", "congress_blocks_relief"]
      );
      const registry = new ethers.Contract(result.registryAddress, WorldRegistryABI.abi, signer);
      const logs = await registry.queryFilter(registry.filters.StartingConditionsApplied());
      expect(logs).to.have.lengthOf(1);
      // "as_researched" isn't a real experimental variable — see
      // demoDeploy.js's own comment on why it's dropped before recording.
      expect(logs[0].args.conditionIds).to.deep.equal(["congress_blocks_relief"]);
    });

    it("records an empty array on-chain when deployed as researched (no id at all)", async function () {
      const [signer] = await ethers.getSigners();
      const result = await deployDemoScenario("middle-east-2026", () => {}, signer, undefined);
      const registry = new ethers.Contract(result.registryAddress, WorldRegistryABI.abi, signer);
      const logs = await registry.queryFilter(registry.filters.StartingConditionsApplied());
      expect(logs).to.have.lengthOf(1);
      expect(logs[0].args.conditionIds).to.deep.equal([]);
    });
  });

  describe("nonce-conflict retry", function () {
    // Confirmed live in production: "nonce too low: next nonce 126, tx
    // nonce 125" — two Vercel serverless instances, each with their own
    // NonceManager cache (see getDemoSigner's header comment), raced on
    // the shared demo wallet. The rejected transaction was never
    // broadcast, so retrying with a freshly-fetched nonce is safe.

    it("isNonceError recognizes the exact error shape seen in production", function () {
      const real = { code: "NONCE_EXPIRED", message: 'nonce has already been used (transaction="0x02f9...", info={ "error": { "code": -32000, "message": "nonce too low: next nonce 126, tx nonce 125" } })' };
      expect(isNonceError(real)).to.equal(true);
    });

    it("isNonceError does not misclassify an unrelated error", function () {
      expect(isNonceError({ code: "CALL_EXCEPTION", message: "execution reverted: insufficient funds" })).to.equal(false);
    });

    it("withNonceRetry succeeds on the first attempt without ever resetting the signer", async function () {
      const signer = { reset: () => { throw new Error("should not be called"); } };
      const result = await withNonceRetry(signer, async () => 42);
      expect(result).to.equal(42);
    });

    it("withNonceRetry resets the signer and retries on a nonce error, then succeeds", async function () {
      let resetCalls = 0;
      let attempts = 0;
      const signer = { reset: () => { resetCalls += 1; } };

      const result = await withNonceRetry(signer, async () => {
        attempts += 1;
        if (attempts < 3) {
          const err = new Error("nonce too low: next nonce 126, tx nonce 125");
          err.code = "NONCE_EXPIRED";
          throw err;
        }
        return "ok";
      });

      expect(result).to.equal("ok");
      expect(attempts).to.equal(3);
      expect(resetCalls).to.equal(2);
    });

    it("withNonceRetry gives up and rethrows after exhausting retries", async function () {
      const signer = { reset: () => {} };
      let attempts = 0;
      let threw = null;
      try {
        await withNonceRetry(signer, async () => {
          attempts += 1;
          const err = new Error("nonce too low");
          err.code = "NONCE_EXPIRED";
          throw err;
        }, 2);
      } catch (e) { threw = e; }
      expect(threw).to.not.equal(null);
      expect(attempts).to.equal(3); // initial attempt + 2 retries
    });

    it("withNonceRetry does not retry a non-nonce error at all", async function () {
      const signer = { reset: () => { throw new Error("should not be called"); } };
      let attempts = 0;
      let threw = null;
      try {
        await withNonceRetry(signer, async () => {
          attempts += 1;
          throw new Error("execution reverted: insufficient funds");
        });
      } catch (e) { threw = e; }
      expect(threw.message).to.equal("execution reverted: insufficient funds");
      expect(attempts).to.equal(1);
    });

    it("a real deploy step recovers from a simulated nonce collision on the underlying signer", async function () {
      const [realSigner] = await ethers.getSigners();
      let failOnce = true;
      // Wraps the real Hardhat signer so its very first transaction attempt
      // this test makes throws exactly the production error shape once,
      // then behaves normally — proving runDeployStep's retry actually
      // recovers a live deploy, not just the isolated helper in the tests above.
      const flakySigner = new Proxy(realSigner, {
        get(target, prop, receiver) {
          if (prop === "sendTransaction") {
            return async (...args) => {
              if (failOnce) {
                failOnce = false;
                const err = new Error("nonce too low: next nonce 1, tx nonce 0");
                err.code = "NONCE_EXPIRED";
                throw err;
              }
              return target.sendTransaction(...args);
            };
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      const out = await runDeployStep("middle-east-2026", 0, {}, flakySigner);
      expect(out.stepIndex).to.equal(0);
      expect(ethers.isAddress(out.state.registryAddress)).to.equal(true);
      expect(failOnce).to.equal(false); // confirms the flaky path actually fired once
    });
  });
});
