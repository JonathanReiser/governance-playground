/**
 * Tests for cycleRunner.js's on-chain-narrative helpers —
 * buildDecisionRecords, summarizeQuantum, summarizeMarket — the pieces
 * that turn one cycle's raw decisions/quantum/market objects into the
 * plain strings LiveRunPanel.jsx sends to commitCycleWithNarrative()
 * (see contracts/core/WorldRegistry.sol and server/demoDeploy.js).
 * Uses the real scenario configs, same convention as
 * instinctWiring.test.js, so aAxis/bAxis/standalone role names below
 * match this scenario's actual aiAgents config rather than a fixture
 * that could drift from it.
 */
import { describe, it, expect } from "vitest";
import { buildDecisionRecords, summarizeQuantum, summarizeMarket } from "../cycleRunner.js";
import middleEast from "../../../../scenarios/middle-east-2026.config.cjs";

describe("buildDecisionRecords", () => {
  it("maps a fulfilled decision per nation into a DecisionRecord shape", () => {
    const decisions = {
      iran: { decision: { primaryAction: "Reject the MOU", reasoning: "Hardliners dominate.", researchNote: "cites MOU text" } },
      israel: { decision: { primaryAction: "Hold posture", reasoning: "Deterrence unchanged.", researchNote: "" } },
    };
    expect(buildDecisionRecords(decisions)).toEqual([
      { nationId: "iran", primaryAction: "Reject the MOU", reasoning: "Hardliners dominate.", researchNote: "cites MOU text" },
      { nationId: "israel", primaryAction: "Hold posture", reasoning: "Deterrence unchanged.", researchNote: "" },
    ]);
  });

  it("skips a nation whose agent call errored — nothing true to record", () => {
    const decisions = {
      iran: { decision: { primaryAction: "Reject", reasoning: "r", researchNote: "" } },
      israel: { error: "timeout" },
    };
    const records = buildDecisionRecords(decisions);
    expect(records).toHaveLength(1);
    expect(records[0].nationId).toBe("iran");
  });

  it("returns an empty array when every nation errored", () => {
    expect(buildDecisionRecords({ iran: { error: "x" }, israel: { error: "y" } })).toEqual([]);
  });

  it("truncates an oversized field rather than sending it in full", () => {
    const decisions = { iran: { decision: { primaryAction: "a".repeat(1000), reasoning: "", researchNote: "" } } };
    const [record] = buildDecisionRecords(decisions);
    expect(record.primaryAction.length).toBeLessThanOrEqual(480);
    expect(record.primaryAction.endsWith("…")).toBe(true);
  });

  it("coerces a missing/non-string field to an empty string instead of throwing", () => {
    const decisions = { iran: { decision: { primaryAction: null, reasoning: undefined, researchNote: 42 } } };
    expect(buildDecisionRecords(decisions)).toEqual([
      { nationId: "iran", primaryAction: "", reasoning: "", researchNote: "" },
    ]);
  });
});

describe("summarizeQuantum", () => {
  it("names every qubit's collapsed outcome plus the entangled effect label", () => {
    const quantum = { iran: "hardline", israel: "firm", saudi_arabia: "aligned", entangledEffect: { label: "entangled escalation" } };
    const summary = summarizeQuantum(middleEast, quantum);
    expect(summary).toContain("iran: hardline");
    expect(summary).toContain("israel: firm");
    expect(summary).toContain("entangled escalation");
  });

  it("omits the effect clause when there's no entangled effect this cycle", () => {
    const quantum = { iran: "hardline", israel: "firm", saudi_arabia: "aligned", entangledEffect: null };
    expect(summarizeQuantum(middleEast, quantum)).not.toContain("—");
  });

  it("returns a plain fallback string when there's no quantum event at all", () => {
    expect(summarizeQuantum(middleEast, null)).toBe("No quantum collapse recorded this cycle.");
  });
});

describe("summarizeMarket", () => {
  it("lists every instrument's outcome plus a derived note when present", () => {
    const market = {
      outcomes: { primary: "SPIKE", currencyA: "WEAKENS", currencyB: "STRENGTHENS", global: "FIRMING" },
      derivedNote: { label: "Dollar Direction", value: "FIRMING" },
    };
    const summary = summarizeMarket(market);
    expect(summary).toContain("primary: SPIKE");
    expect(summary).toContain("Dollar Direction: FIRMING");
  });

  it("returns a plain fallback string when there's no market event at all", () => {
    expect(summarizeMarket(null)).toBe("No market movement recorded this cycle.");
    expect(summarizeMarket({})).toBe("No market movement recorded this cycle.");
  });
});
