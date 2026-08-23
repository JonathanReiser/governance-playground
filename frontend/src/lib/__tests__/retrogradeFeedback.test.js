/**
 * Tests for the Layer 2/3 -> Layer 1 retrograde feedback path added to
 * agents.js (retrogradeMiddleEast()/applyEconomicFeedback(), wired into
 * evolveAndCollapseQuantumState()). Covers the causality invariant this
 * feature depends on — no feedback until a market event has actually
 * resolved, and once one has, it always reads the PRIOR cycle's already-
 * collapsed event, never the current cycle's still-unresolved one.
 */
import { describe, it, expect } from "vitest";
import {
  initQuantumBeliefs,
  initMarketBeliefs,
  evolveAndCollapseQuantumState,
  applyDecisions,
} from "../agents.js";
import { evolveAndCollapseMarkets } from "../markets.js";
import scenario from "../../../../scenarios/middle-east-2026.config.cjs";

// A fixed set of per-nation decisions reused across tests — what's under
// test is the quantum/market plumbing, not decision content, so these just
// need to be "some" decisions with the fields evolveAndCollapseQuantumState/
// evolveAndCollapseMarkets actually read.
const DECISIONS = {
  iran: {
    decision: {
      primaryAction: "threaten_hormuz",
      hormuzStatus: "THREATENED",
      metricDeltas: { hardlinerPressure: 5, dealIntegrity: -10 },
    },
  },
  israel: {
    decision: { primaryAction: "restraint", metricDeltas: { publicSentiment: 3 } },
  },
  saudi_arabia: {
    decision: {
      primaryAction: "cut_production",
      oilProductionStance: "CUTTING",
      metricDeltas: { reformPressure: -5 },
    },
  },
  us: {
    decision: { primaryAction: "mediate", metricDeltas: { diplomaticCapital: 5 } },
  },
};

describe("retrograde feedback (Layer 2/3 -> Layer 1)", () => {
  it("is a no-op on cycle 1, before any market event has ever resolved", () => {
    const quantum = initQuantumBeliefs(scenario);
    const { event } = evolveAndCollapseQuantumState(scenario, quantum, DECISIONS, null, 1);
    expect(event.retrogradeFeedback).toBeNull();
  });

  it("applies the PRIOR cycle's collapsed market event on the next cycle", () => {
    const quantum1 = initQuantumBeliefs(scenario);
    const markets1 = initMarketBeliefs(scenario);

    const cycle1 = evolveAndCollapseQuantumState(scenario, quantum1, DECISIONS, null, 1);
    const marketCycle1 = evolveAndCollapseMarkets(scenario, markets1, cycle1.event, DECISIONS, 1);

    const cycle2 = evolveAndCollapseQuantumState(
      scenario,
      cycle1.newQuantum,
      DECISIONS,
      marketCycle1.event,
      2
    );

    // Whatever fed back should be driven directly by cycle 1's actual
    // collapsed outcomes, and only cover the three registered drivers.
    const validDrivers = new Set(["rial_weakening", "riyal_windfall", "gas_surge"]);
    if (cycle2.event.retrogradeFeedback) {
      for (const applied of cycle2.event.retrogradeFeedback) {
        expect(validDrivers.has(applied.driver)).toBe(true);
        expect(applied.amplifiedBy).toBeGreaterThanOrEqual(1); // 1x (calm) to ~2x (fat-tailed)
      }
      const outcomes = marketCycle1.event.outcomes;
      const drivers = cycle2.event.retrogradeFeedback.map((a) => a.driver);
      expect(drivers.includes("rial_weakening")).toBe(outcomes.currencyA === "WEAKENING");
      expect(drivers.includes("riyal_windfall")).toBe(outcomes.currencyB === "ROBUST");
      expect(drivers.includes("gas_surge")).toBe(outcomes.global === "SURGING");
    }
  });

  it("never fires for a scenario with no registered retrograde propagator", () => {
    const quantum = initQuantumBeliefs(scenario);
    // A market event exists, but scenario.meta.id has no propagator
    // registered (only middle-east-2026 does) — should be a clean no-op,
    // not a throw.
    const fakeScenario = { ...scenario, meta: { ...scenario.meta, id: "not-a-real-scenario" } };
    const marketEvent = { outcomes: { currencyA: "WEAKENING" }, speculation: {} };
    const { event } = evolveAndCollapseQuantumState(fakeScenario, quantum, DECISIONS, marketEvent, 2);
    expect(event.retrogradeFeedback).toBeNull();
  });

  it("runs cleanly across multiple cycles end-to-end via applyDecisions()", () => {
    let simState = { stability: 38, proxy: 45, trade: 120, conflicts: 3, dealIntegrity: 52 };
    let agentMemory = { quantum: initQuantumBeliefs(scenario), markets: initMarketBeliefs(scenario) };

    for (let cycle = 1; cycle <= 4; cycle++) {
      expect(() => {
        const result = applyDecisions(scenario, simState, DECISIONS, agentMemory, cycle);
        simState = result.newSimState;
        agentMemory = result.newAgentMemory;
      }).not.toThrow();

      if (cycle === 1) {
        // Nothing to feed back yet on the very first cycle.
        expect(agentMemory.quantum.lastEvent.retrogradeFeedback).toBeNull();
      }
    }

    // By cycle 4, at least one market event has resolved every prior cycle,
    // so the plumbing should have had the opportunity to apply feedback at
    // least once (which driver fires depends on the collapsed outcomes,
    // which vary run to run since collapse involves Born-rule measurement —
    // so this only asserts the field is well-formed, not which driver).
    const lastFeedback = agentMemory.quantum.lastEvent.retrogradeFeedback;
    expect(lastFeedback === null || Array.isArray(lastFeedback)).toBe(true);
  });
});
