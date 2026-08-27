/**
 * Tests for server/scenarioOverrides.js — applying a real, cited
 * `startingConditionProposals` entry to a scenario before deploy.
 */

const { expect } = require("chai");
const { applyStartingConditionOverride, applyStartingConditionOverrides } = require("../server/scenarioOverrides");
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

  it("eisenkot_wins_election shifts Israel's public sentiment without touching Palestinian-statehood-adjacent fields", function () {
    // Deliberately narrow proposal (see its own description/source in the
    // scenario config): Eisenkot's real, cited position on Palestinian
    // statehood matches Netanyahu's, so this override must NOT move
    // anything that would misrepresent that — only publicSentiment/
    // population.sentiment, reflecting the real cited polling momentum.
    const out = applyStartingConditionOverride(middleEast, "eisenkot_wins_election");
    const israel = out.nations.find((n) => n.id === "israel");
    expect(israel.governance.publicSentiment).to.equal(60);
    expect(israel.population.sentiment).to.equal(60);
    // Unrelated fields, including Iran's, stay exactly at baseline
    expect(israel.governance.guardianVeto).to.equal(middleEast.nations.find((n) => n.id === "israel").governance.guardianVeto);
    expect(out.nations.find((n) => n.id === "iran").governance.hardlinerPressure)
      .to.equal(middleEast.nations.find((n) => n.id === "iran").governance.hardlinerPressure);
  });
});

describe("server/scenarioOverrides.js — applyStartingConditionOverrides (multiple at once)", function () {
  it("returns the scenario unchanged for an empty or missing list", function () {
    for (const ids of [[], undefined, null]) {
      const out = applyStartingConditionOverrides(middleEast, ids);
      expect(out.nations.find((n) => n.id === "iran").governance.hardlinerPressure)
        .to.equal(middleEast.nations.find((n) => n.id === "iran").governance.hardlinerPressure);
    }
  });

  it("accepts a single id (not just an array) and behaves like the singular function", function () {
    const viaSingular = applyStartingConditionOverride(middleEast, "congress_blocks_relief");
    const viaPlural = applyStartingConditionOverrides(middleEast, "congress_blocks_relief");
    expect(viaPlural.nations.find((n) => n.id === "iran").governance.hardlinerPressure)
      .to.equal(viaSingular.nations.find((n) => n.id === "iran").governance.hardlinerPressure);
  });

  it("combines two non-overlapping fields from different proposals", function () {
    // congress_blocks_relief sets Iran's economy fields; saudi_normalizes_anyway
    // sets Saudi Arabia's reformPressure — genuinely independent nations/fields.
    const out = applyStartingConditionOverrides(middleEast, ["congress_blocks_relief", "saudi_normalizes_anyway"]);
    expect(out.nations.find((n) => n.id === "iran").economy.sanctionsReliefPending).to.equal(false);
    expect(out.nations.find((n) => n.id === "saudi_arabia").governance.reformPressure).to.equal(65);
  });

  it("resolves a real overlapping field (Iran hardlinerPressure, set by both) as last-in-the-list wins", function () {
    // congress_blocks_relief alone sets it to 88; senate_sanctions_bill_enacted
    // alone sets it to 85 — applying both, in that order, must land on 85, not 88.
    const congressAlone = applyStartingConditionOverride(middleEast, "congress_blocks_relief");
    expect(congressAlone.nations.find((n) => n.id === "iran").governance.hardlinerPressure).to.equal(88);

    const combined = applyStartingConditionOverrides(middleEast, ["congress_blocks_relief", "senate_sanctions_bill_enacted"]);
    expect(combined.nations.find((n) => n.id === "iran").governance.hardlinerPressure).to.equal(85);

    // Reversing the order reverses which one wins — confirms it's genuinely
    // order-dependent, not coincidentally always the second proposal's value.
    const reversed = applyStartingConditionOverrides(middleEast, ["senate_sanctions_bill_enacted", "congress_blocks_relief"]);
    expect(reversed.nations.find((n) => n.id === "iran").governance.hardlinerPressure).to.equal(88);
  });

  it("skips an unknown id within the list, applying the rest (fails safe, not throws)", function () {
    const out = applyStartingConditionOverrides(middleEast, ["not-a-real-proposal", "saudi_normalizes_anyway"]);
    expect(out.nations.find((n) => n.id === "saudi_arabia").governance.reformPressure).to.equal(65);
  });

  it("does not mutate the original scenario object", function () {
    const before = JSON.stringify(middleEast);
    applyStartingConditionOverrides(middleEast, ["congress_blocks_relief", "saudi_normalizes_anyway"]);
    expect(JSON.stringify(middleEast)).to.equal(before);
  });

  it("combines all three real Taiwan Strait proposals together without throwing", function () {
    const out = applyStartingConditionOverrides(taiwanStrait, [
      "arms_package_delivered", "china_expands_japan_export_ban", "trilateral_semiconductor_pact",
    ]);
    expect(out).to.be.an("object");
    expect(out.nations.find((n) => n.id === "china").governance.hardlinerPressure).to.be.a("number");
  });
});
