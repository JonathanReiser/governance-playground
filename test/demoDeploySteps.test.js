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
} = require("../server/demoDeploy");

const WorldRegistryABI = require("../frontend/src/abi/WorldRegistry.json");
const middleEast = require("../frontend/src/scenarios/middle-east-2026.json");
const taiwanStrait = require("../frontend/src/scenarios/taiwan-strait-2026.json");

const SCENARIOS = { "middle-east-2026": middleEast, "taiwan-strait-2026": taiwanStrait };

function expectedStepTypes(scenario) {
  return [
    "deployRegistry", "deployOracle", "wireOracle", "deployTokenFactory",
    "deployDaoFactory", "wireFactories", "initScenario",
    ...scenario.nations.map(() => "registerNation"),
    ...Object.keys(scenario.citizenDistribution || {}).map(() => "distributeCitizenship"),
    ...scenario.relationships.map(() => "setRelationship"),
    ...scenario.activeEvents
      .filter((e) => e.type === "PEACE_DEAL" || e.type === "RESOURCE_EVENT")
      .map(() => "registerEvent"),
    "setMetrics", "startSimulation",
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
      expect(messages[messages.length - 1]).to.equal("Starting simulation…");
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
        signer
      );
      expect(out1.currentCycle).to.equal(1);
      expect(out1.simulationActive).to.equal(true);
      expect(await registry.currentCycle()).to.equal(1n);

      const out2 = await commitDemoCycle(
        deployResult.registryAddress,
        { stability: 40, conflicts: 8, trade: 90, proxy: 60, dealIntegrity: 30 },
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
        signer
      );
      expect(out.metrics).to.deep.equal({ stability: 100, conflicts: 0, trade: 0, proxy: 41, dealIntegrity: 60 });
      expect(out.currentCycle).to.equal(1);
    });
  });
});
