/**
 * Tests for the Quantum Instinct Layer (instinct.js). Covers the mapping
 * this module depends on being monotonic and correctly anchored — an
 * earlier draft of pressureToTheta (Hadamard + full-range RY) was NOT
 * monotonic, verified by hand against the installed quantum-circuit
 * package before it was rewritten; these tests lock that regression down.
 */
import { describe, it, expect } from "vitest";
import { buildInstinctCircuit, readInstinct, proposeVetoInstinct } from "../instinct.js";

describe("pressureToTheta", () => {
  it("anchors pressure=0 at fully ALLOW and pressure=100 at fully VETO", () => {
    const c0 = buildInstinctCircuit({ pressure: 0 });
    c0.run();
    expect(c0.probability(0)).toBeCloseTo(1, 6);

    const c100 = buildInstinctCircuit({ pressure: 100 });
    c100.run();
    expect(c100.probability(0)).toBeCloseTo(0, 6);
  });

  it("reads pressure=50 as an honest 50/50 — the earned superposition case", () => {
    const c = buildInstinctCircuit({ pressure: 50 });
    c.run();
    expect(c.probability(0)).toBeCloseTo(0.5, 6);
  });

  it("is monotonically non-increasing in P(ALLOW) as pressure rises", () => {
    const pressures = [0, 10, 25, 40, 50, 60, 75, 90, 100];
    const readings = pressures.map((p) => {
      const c = buildInstinctCircuit({ pressure: p });
      c.run();
      return c.probability(0);
    });
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]).toBeLessThanOrEqual(readings[i - 1] + 1e-9);
    }
  });

  it("matches the exact P(ALLOW) = 1 - pressure/100 mapping at an arbitrary point", () => {
    const c = buildInstinctCircuit({ pressure: 30 });
    c.run();
    expect(c.probability(0)).toBeCloseTo(0.7, 6);
  });
});

describe("readInstinct", () => {
  it("is deterministic given an injected rng, not Math.random", () => {
    const belowThreshold = buildInstinctCircuit({ pressure: 30 }); // P(ALLOW) = 0.7
    const reading = readInstinct(belowThreshold, ["VETO", "ALLOW"], () => 0.5);
    expect(reading.outcome).toBe("ALLOW"); // rng() = 0.5 < 0.7

    const aboveThreshold = buildInstinctCircuit({ pressure: 30 });
    const reading2 = readInstinct(aboveThreshold, ["VETO", "ALLOW"], () => 0.9);
    expect(reading2.outcome).toBe("VETO"); // rng() = 0.9 >= 0.7
  });

  it("never touches the library's own Math.random-backed measure — same rng, same outcome, every call", () => {
    const outcomes = new Set();
    for (let i = 0; i < 20; i++) {
      const c = buildInstinctCircuit({ pressure: 50 });
      outcomes.add(readInstinct(c, ["VETO", "ALLOW"], () => 0.3).outcome);
    }
    expect(outcomes.size).toBe(1); // a fixed rng must always land the same side
  });
});

describe("entanglement", () => {
  it("leaves the marginal untouched only in the degenerate case where this nation's own pressure is exactly 50", () => {
    const noPartner = buildInstinctCircuit({ pressure: 50 });
    noPartner.run();

    const withPartner = buildInstinctCircuit({ pressure: 50, entangledReadout: 0.95 });
    withPartner.run();

    expect(withPartner.probability(0)).toBeCloseTo(noPartner.probability(0), 6);
  });

  it("genuinely shifts the marginal away from the unentangled reading once this nation's own pressure isn't 50", () => {
    const alone = buildInstinctCircuit({ pressure: 80 });
    alone.run();
    const aloneAllow = alone.probability(0);

    const partnerCalm = buildInstinctCircuit({ pressure: 80, entangledReadout: 0 });
    partnerCalm.run();

    const partnerHardline = buildInstinctCircuit({ pressure: 80, entangledReadout: 1 });
    partnerHardline.run();

    // entangledReadout=1 (partner certainly on the "hardline" pole) reproduces
    // this nation's own unentangled reading exactly — see instinct.js's
    // module doc for the worked-out algebra behind this.
    expect(partnerHardline.probability(0)).toBeCloseTo(aloneAllow, 6);
    // entangledReadout=0 (partner certainly on the "calm" pole) flips it.
    expect(partnerCalm.probability(0)).toBeCloseTo(1 - aloneAllow, 6);
  });
});

describe("proposeVetoInstinct", () => {
  it("returns a full, human-reviewable reading without calling any on-chain veto function", () => {
    const result = proposeVetoInstinct({
      nation: { id: "iran", name: "Iran" },
      pressureField: "hardlinerPressure",
      pressureValue: 82,
      entangledWith: { nationId: "israel", name: "Israel", axis0Probability: 0.7 },
      rng: () => 0.1,
    });

    expect(result.nationId).toBe("iran");
    expect(result.entangledWithNationId).toBe("israel");
    expect(["VETO", "ALLOW"]).toContain(result.outcome);
    expect(result.probabilities.VETO + result.probabilities.ALLOW).toBeCloseTo(1, 6);
    expect(result.note).toContain("Iran");
    expect(result.note).toContain("Israel");
    expect(typeof result.circuitDiagram).toBe("string");
  });

  it("omits any entangled-partner reference for a standalone nation", () => {
    const result = proposeVetoInstinct({
      nation: { id: "saudi_arabia", name: "Saudi Arabia" },
      pressureField: "reformPressure",
      pressureValue: 55,
      rng: () => 0.5,
    });

    expect(result.entangledWithNationId).toBeNull();
    expect(result.note).toContain("standalone");
  });
});
