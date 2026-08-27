/**
 * BatchExperimentRegistry — tests for the batch/preregistration path.
 * See contracts/research/BatchExperimentRegistry.sol's own header for why
 * this is a separate, much lighter contract than a WorldRegistry deploy.
 */

import { expect } from "chai";
import hre        from "hardhat";
const { ethers }  = hre;

function experimentId(seed) {
  return ethers.keccak256(ethers.toUtf8Bytes(seed));
}

describe("BatchExperimentRegistry", function () {
  let registry, researcher, other;

  beforeEach(async function () {
    [, researcher, other] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("BatchExperimentRegistry");
    registry = await Registry.deploy();
  });

  describe("registerExperiment", function () {
    it("records the config and emits ExperimentRegistered", async function () {
      const id = experimentId("exp-1");
      await expect(
        registry.connect(researcher).registerExperiment(
          id, "middle-east-2026", ["congress_blocks_relief"], "Blocking relief lowers stability", 50, 5
        )
      )
        .to.emit(registry, "ExperimentRegistered")
        .withArgs(id, researcher.address, "middle-east-2026", ["congress_blocks_relief"], "Blocking relief lowers stability", 50, 5);

      const exp = await registry.experiments(id);
      expect(exp.researcher).to.equal(researcher.address);
      expect(exp.scenarioId).to.equal("middle-east-2026");
      expect(exp.hypothesis).to.equal("Blocking relief lowers stability");
      expect(exp.trialCount).to.equal(50n);
      expect(exp.cyclesPerTrial).to.equal(5n);
      expect(exp.exists).to.equal(true);
    });

    it("stores startingConditionIds, retrievable via the explicit getter", async function () {
      const id = experimentId("exp-multi-condition");
      await registry.connect(researcher).registerExperiment(
        id, "middle-east-2026", ["congress_blocks_relief", "saudi_normalizes_anyway"], "combined effect", 10, 3
      );
      const ids = await registry.getStartingConditionIds(id);
      expect(ids).to.deep.equal(["congress_blocks_relief", "saudi_normalizes_anyway"]);
    });

    it("accepts an empty startingConditionIds list (as-researched baseline)", async function () {
      const id = experimentId("exp-baseline");
      await registry.connect(researcher).registerExperiment(id, "middle-east-2026", [], "baseline distribution", 20, 5);
      expect(await registry.getStartingConditionIds(id)).to.deep.equal([]);
    });

    it("rejects a reused experiment id — preregistration can't be silently overwritten", async function () {
      const id = experimentId("exp-dup");
      await registry.connect(researcher).registerExperiment(id, "middle-east-2026", [], "first", 10, 5);
      await expect(
        registry.connect(other).registerExperiment(id, "middle-east-2026", [], "second, trying to overwrite", 10, 5)
      ).to.be.revertedWith("BatchExperimentRegistry: experiment id already used");
    });

    it("rejects an empty scenarioId", async function () {
      await expect(
        registry.connect(researcher).registerExperiment(experimentId("x"), "", [], "h", 10, 5)
      ).to.be.revertedWith("BatchExperimentRegistry: scenarioId required");
    });

    it("rejects trialCount of 0", async function () {
      await expect(
        registry.connect(researcher).registerExperiment(experimentId("x"), "middle-east-2026", [], "h", 0, 5)
      ).to.be.revertedWith("BatchExperimentRegistry: trialCount must be > 0");
    });

    it("rejects cyclesPerTrial of 0", async function () {
      await expect(
        registry.connect(researcher).registerExperiment(experimentId("x"), "middle-east-2026", [], "h", 10, 0)
      ).to.be.revertedWith("BatchExperimentRegistry: cyclesPerTrial must be > 0");
    });
  });

  describe("recordTrialResult", function () {
    let id;
    beforeEach(async function () {
      id = experimentId("exp-trials");
      await registry.connect(researcher).registerExperiment(id, "middle-east-2026", [], "h", 3, 5);
    });

    it("records a trial and emits TrialResultRecorded", async function () {
      await expect(
        registry.connect(researcher).recordTrialResult(id, 0, 30, 40, 50, 110, 5)
      )
        .to.emit(registry, "TrialResultRecorded")
        .withArgs(id, 0, 30, 40, 50, 110, 5);

      const result = await registry.trialResults(id, 0);
      expect(result.recorded).to.equal(true);
      expect(result.finalStability).to.equal(30n);
      expect(result.finalDealIntegrity).to.equal(40n);
      expect(result.finalProxyActivity).to.equal(50n);
      expect(result.finalTradeVolume).to.equal(110n);
      expect(result.finalConflictEvents).to.equal(5n);
    });

    it("increments recordedTrialCount per distinct trial", async function () {
      await registry.connect(researcher).recordTrialResult(id, 0, 30, 40, 50, 110, 5);
      expect(await registry.recordedTrialCount(id)).to.equal(1n);
      await registry.connect(researcher).recordTrialResult(id, 1, 28, 38, 52, 112, 6);
      expect(await registry.recordedTrialCount(id)).to.equal(2n);
    });

    it("only the registering researcher may record a trial — prevents injecting fake results into someone else's experiment", async function () {
      await expect(
        registry.connect(other).recordTrialResult(id, 0, 30, 40, 50, 110, 5)
      ).to.be.revertedWith("BatchExperimentRegistry: not this experiment's researcher");
    });

    it("rejects an unknown experiment id", async function () {
      await expect(
        registry.connect(researcher).recordTrialResult(experimentId("never-registered"), 0, 30, 40, 50, 110, 5)
      ).to.be.revertedWith("BatchExperimentRegistry: unknown experiment");
    });

    it("rejects a trialIndex out of range for the declared trialCount", async function () {
      await expect(
        registry.connect(researcher).recordTrialResult(id, 3, 30, 40, 50, 110, 5) // trialCount is 3, valid indices 0-2
      ).to.be.revertedWith("BatchExperimentRegistry: trialIndex out of range");
    });

    it("rejects recording the same trialIndex twice", async function () {
      await registry.connect(researcher).recordTrialResult(id, 0, 30, 40, 50, 110, 5);
      await expect(
        registry.connect(researcher).recordTrialResult(id, 0, 99, 99, 99, 99, 99)
      ).to.be.revertedWith("BatchExperimentRegistry: trial already recorded");
    });

    it("rejects out-of-range metric values", async function () {
      await expect(registry.connect(researcher).recordTrialResult(id, 0, 101, 40, 50, 110, 5))
        .to.be.revertedWith("BatchExperimentRegistry: stability 0-100");
      await expect(registry.connect(researcher).recordTrialResult(id, 0, 30, 101, 50, 110, 5))
        .to.be.revertedWith("BatchExperimentRegistry: dealIntegrity 0-100");
      await expect(registry.connect(researcher).recordTrialResult(id, 0, 30, 40, 101, 110, 5))
        .to.be.revertedWith("BatchExperimentRegistry: proxyActivity 0-100");
      await expect(registry.connect(researcher).recordTrialResult(id, 0, 30, 40, 50, 501, 5))
        .to.be.revertedWith("BatchExperimentRegistry: tradeVolume 0-500");
      await expect(registry.connect(researcher).recordTrialResult(id, 0, 30, 40, 50, 110, 1000))
        .to.be.revertedWith("BatchExperimentRegistry: conflictEvents 0-999");
    });
  });

  describe("isComplete", function () {
    it("is false until every declared trial is recorded, true once they all are", async function () {
      const id = experimentId("exp-complete");
      await registry.connect(researcher).registerExperiment(id, "middle-east-2026", [], "h", 2, 5);
      expect(await registry.isComplete(id)).to.equal(false);

      await registry.connect(researcher).recordTrialResult(id, 0, 30, 40, 50, 110, 5);
      expect(await registry.isComplete(id)).to.equal(false);

      await registry.connect(researcher).recordTrialResult(id, 1, 28, 38, 52, 112, 6);
      expect(await registry.isComplete(id)).to.equal(true);
    });

    it("is false for an experiment that was never registered", async function () {
      expect(await registry.isComplete(experimentId("never-registered"))).to.equal(false);
    });
  });
});
