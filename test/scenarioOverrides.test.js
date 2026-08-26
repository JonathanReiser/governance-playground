/**
 * Tests for server/scenarioOverrides.js — applying a real, cited
 * `startingConditionProposals` entry to a scenario before deploy.
 */

const { expect } = require("chai");
const { applyStartingConditionOverride } = require("../server/scenarioOverrides");
const middleEast = require("../frontend/src/scenarios/middle-east-2026.json");
const taiwanStrait = require("../frontend/src/scenarios/taiwan-strait-2026.json");

describe("server/scenarioOverrides.js — applyStartingConditionOverride", function () {
  it("both scenarios declare the required 'as_researched' default with no overrides", function () {
    for (const scenario of [middleEast, taiwanStrait]) {
      const proposals = scenario.startingConditionProposals;
      expect(proposals).to.be.an("array").with.length.greaterThan(0);
      const def = proposals.find((p) => p.id === "as_researched");
      expect(def, `${scenario.meta.id} missing as_researched`).to.exist;
      expect(def.overrides).to.equal(null);
    }
  });

  it("every non-default proposal cites a real source", function () {
    for (const scenario of [middleEast, taiwanStrait]) {
      for (const p of scenario.startingConditionProposals) {
        if (p.id === "as_researched") continue;
        expect(p.source, `${scenario.meta.id}/${p.id} has no source`).to.be.a("string").and.not.empty;
      }
    }
  });

  it("returns the scenario unchanged for the default id", function () {
    const out = applyStartingConditionOverride(middleEast, "as_researched");
    expect(out.nations.find((n) => n.id === "iran").governance.hardlinerPressure)
      .to.equal(middleEast.nations.find((n) => n.id === "iran").governance.hardlinerPressure);
  });

  it("returns the scenario unchanged for an unknown or missing id (fails safe, not throws)", function () {
    for (const badId of ["not-a-real-proposal", undefined, null]) {
      const out = applyStartingConditionOverride(middleEast, badId);
      expect(out.nations.find((n) => n.id === "iran").governance.hardlinerPressure)
        .to.equal(middleEast.nations.find((n) => n.id === "iran").governance.hardlinerPressure);
    }
  });

  it("deep-merges a nation override without touching sibling fields", function () {
    const iranBefore = middleEast.nations.find((n) => n.id === "iran");
    const out = applyStartingConditionOverride(middleEast, "congress_blocks_relief");
    const iranAfter = out.nations.find((n) => n.id === "iran");

    expect(iranAfter.economy.sanctionsReliefPending).to.equal(false);
    expect(iranAfter.economy.sanctioned).to.equal(true);
    expect(iranAfter.governance.hardlinerPressure).to.equal(88);
    // Untouched sibling fields survive the merge
    expect(iranAfter.economy.treasury).to.equal(iranBefore.economy.treasury);
    expect(iranAfter.governance.guardianVeto).to.equal(iranBefore.governance.guardianVeto);
  });

  it("overrides a simulation metric's startingValue by metric id", function () {
    const out = applyStartingConditionOverride(middleEast, "congress_blocks_relief");
    const dealIntegrity = out.simulation.metrics.find((m) => m.id === "deal_integrity");
    expect(dealIntegrity.startingValue).to.equal(25);
  });

  it("does not mutate the original scenario object", function () {
    const before = JSON.stringify(middleEast);
    applyStartingConditionOverride(middleEast, "senate_sanctions_bill_enacted");
    expect(JSON.stringify(middleEast)).to.equal(before);
  });

  it("applies a Taiwan Strait proposal correctly", function () {
    const out = applyStartingConditionOverride(taiwanStrait, "arms_package_delivered");
    expect(out.nations.find((n) => n.id === "china").governance.hardlinerPressure).to.equal(82);
    expect(out.nations.find((n) => n.id === "taiwan").governance.hardlinerPressure).to.equal(32);
    expect(out.simulation.metrics.find((m) => m.id === "deal_integrity").startingValue).to.equal(32);
  });
});
