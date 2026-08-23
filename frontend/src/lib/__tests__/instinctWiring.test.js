/**
 * Tests for the bridge added to agents.js — vetoCapableNations(),
 * resolveInstinctInputs(), proposeInstinctReadings() — that connects the
 * quantum belief state this file already tracks to instinct.js's
 * proposeVetoInstinct(). Uses the real scenario configs, same convention
 * as retrogradeFeedback.test.js, so this is exercised against the actual
 * aiAgents role assignments, not a hand-built fixture that could drift
 * from them.
 */
import { describe, it, expect } from "vitest";
import {
  initQuantumBeliefs,
  buildWorldState,
  vetoCapableNations,
  resolveInstinctInputs,
  proposeInstinctReadings,
} from "../agents.js";
import { marginalB } from "../quantum.js";
import middleEast from "../../../../scenarios/middle-east-2026.config.cjs";
import taiwanStrait from "../../../../scenarios/taiwan-strait-2026.config.cjs";

// Fixed rng for deterministic, network-free tests — proposeInstinctReadings
// forwards this straight to proposeVetoInstinct(), same {value, source}
// contract quantumRandomFloat itself returns.
const fixedRng = (value) => async () => ({ value, source: "test-fixed" });

describe("vetoCapableNations", () => {
  it("finds exactly Iran (guardian) and Saudi Arabia (royal) in Middle East — not Israel or the US", () => {
    const ids = vetoCapableNations(middleEast).map((n) => n.id).sort();
    expect(ids).toEqual(["iran", "saudi_arabia"]);
  });

  it("finds exactly China (royal, repurposed as Politburo override) in Taiwan Strait — not Taiwan or Japan", () => {
    const ids = vetoCapableNations(taiwanStrait).map((n) => n.id);
    expect(ids).toEqual(["china"]);
  });
});

describe("resolveInstinctInputs", () => {
  it("resolves Iran (entangled.aId) to hardlinerPressure + Israel as the entangled partner", () => {
    const quantum = initQuantumBeliefs(middleEast);
    const worldState = buildWorldState(middleEast, { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 }, 1, { quantum });
    const inputs = resolveInstinctInputs(middleEast, worldState, quantum, "iran");

    expect(inputs.pressureField).toBe("hardlinerPressure");
    expect(inputs.pressureValue).toBe(worldState.iran.hardlinerPressure);
    expect(inputs.entangledWith.nationId).toBe("israel");
    expect(inputs.entangledWith.name).toBe("Israel");
    expect(inputs.entangledWith.axis0Probability).toBeCloseTo(marginalB(quantum.entangledPair)[0], 9);
  });

  it("resolves Saudi Arabia (standalone) to reformPressure with no entangled partner", () => {
    const quantum = initQuantumBeliefs(middleEast);
    const worldState = buildWorldState(middleEast, { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 }, 1, { quantum });
    const inputs = resolveInstinctInputs(middleEast, worldState, quantum, "saudi_arabia");

    expect(inputs.pressureField).toBe("reformPressure");
    expect(inputs.pressureValue).toBe(worldState.saudiArabia.reformPressure);
    expect(inputs.entangledWith).toBeNull();
  });

  it("returns null for a nation not assigned any of the four aiAgents roles", () => {
    const quantum = initQuantumBeliefs(middleEast);
    const worldState = buildWorldState(middleEast, { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 }, 1, { quantum });
    expect(resolveInstinctInputs(middleEast, worldState, quantum, "not_a_real_nation")).toBeNull();
  });
});

describe("proposeInstinctReadings", () => {
  it("returns exactly one reading per veto-capable nation, correctly typed guardian vs. royal", async () => {
    const quantum = initQuantumBeliefs(middleEast);
    const worldState = buildWorldState(middleEast, { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 }, 1, { quantum });
    const readings = await proposeInstinctReadings(middleEast, worldState, quantum, fixedRng(0.5));

    expect(Object.keys(readings).sort()).toEqual(["iran", "saudi_arabia"]);
    expect(readings.iran.vetoType).toBe("guardian");
    expect(readings.saudi_arabia.vetoType).toBe("royal");
    expect(readings.israel).toBeUndefined();
    expect(readings.us).toBeUndefined();
  });

  it("every reading is a well-formed, human-reviewable proposal — no on-chain call implied", async () => {
    const quantum = initQuantumBeliefs(middleEast);
    const worldState = buildWorldState(middleEast, { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 }, 1, { quantum });
    const readings = await proposeInstinctReadings(middleEast, worldState, quantum, fixedRng(0.1));

    for (const [nationId, reading] of Object.entries(readings)) {
      expect(reading.nationId).toBe(nationId);
      expect(["VETO", "ALLOW"]).toContain(reading.outcome);
      expect(reading.probabilities.VETO + reading.probabilities.ALLOW).toBeCloseTo(1, 6);
      expect(reading.entropySource).toBe("test-fixed");
      expect(typeof reading.circuitDiagram).toBe("string");
      expect(typeof reading.note).toBe("string");
    }
  });

  it("respects the injected rng deterministically — a low sample allows, a high one vetoes, same as instinct.js's own contract", async () => {
    const quantum = initQuantumBeliefs(middleEast);
    const worldState = buildWorldState(middleEast, { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 }, 1, { quantum });

    const allow = await proposeInstinctReadings(middleEast, worldState, quantum, fixedRng(0.0));
    const veto  = await proposeInstinctReadings(middleEast, worldState, quantum, fixedRng(0.999999));

    // pressure > 0 for both nations in the default config, so P(ALLOW) < 1 —
    // rng=0 always lands ALLOW, rng≈1 always lands VETO, regardless of the
    // exact pressure value.
    expect(allow.iran.outcome).toBe("ALLOW");
    expect(allow.saudi_arabia.outcome).toBe("ALLOW");
    expect(veto.iran.outcome).toBe("VETO");
    expect(veto.saudi_arabia.outcome).toBe("VETO");
  });

  it("finds China's royal-veto reading in Taiwan Strait using its own driver field and entangled partner (Taiwan)", async () => {
    const quantum = initQuantumBeliefs(taiwanStrait);
    const worldState = buildWorldState(taiwanStrait, { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 }, 1, { quantum });
    const readings = await proposeInstinctReadings(taiwanStrait, worldState, quantum, fixedRng(0.5));

    expect(Object.keys(readings)).toEqual(["china"]);
    expect(readings.china.vetoType).toBe("royal");
    expect(readings.china.note).toContain("China");
    expect(readings.china.note).toContain("Taiwan");
  });
});
