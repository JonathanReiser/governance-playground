import { describe, expect, it } from "vitest";
import {
  NEUTRAL_LABELS, appendArenaPlay, drawOpponentOperation, labelFor, readArenaPlays,
  policyLabelFor, profileLabelFor,
} from "../arena";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const play = (profile = "CC") => ({ schema: "quantum-arena-play/v1", measured_profile: profile });

describe("participant-facing labels", () => {
  it("never leaks the theoretical names to the participant", () => {
    // The protocol forbids telling a participant a setting is intelligent,
    // optimal or "more quantum". C/D/M/Q and cooperate/defect do exactly that.
    const forbidden = /\b(cooperate|defect|quantum|optimal|best|classical|mix)\b/i;
    for (const { label } of NEUTRAL_LABELS) {
      expect(label).not.toMatch(forbidden);
      expect(label).not.toMatch(/^[CDMQ]$/);
    }
  });

  it("covers the frozen menu exactly once each, in menu order", () => {
    expect(NEUTRAL_LABELS.map((entry) => entry.operation)).toEqual(["C", "D", "M", "Q"]);
  });

  it("maps operations back to what the participant saw", () => {
    expect(labelFor("Q")).toBe("Setting IV");
    expect(labelFor("nope")).toBe("unknown");
  });

  it("keeps internal measured-policy codes out of result labels", () => {
    expect(policyLabelFor("C")).toBe("Policy I");
    expect(policyLabelFor("D")).toBe("Policy II");
    expect(profileLabelFor("CD")).toBe("Policy I / Policy II");
    for (const label of [policyLabelFor("C"), policyLabelFor("D"), profileLabelFor("CC"), profileLabelFor("DD")]) {
      expect(label).not.toMatch(/\b[CDMQ]\b/);
    }
  });
});

describe("opponent draw", () => {
  it("uses web crypto and reports the source", () => {
    const cryptoApi = { getRandomValues: (array) => { array[0] = 3; return array; } };
    expect(drawOpponentOperation(cryptoApi)).toEqual({ operation: "Q", source: "web-crypto" });
  });

  it.each([
    ["null", null],
    ["an object without getRandomValues", {}],
  ])("refuses rather than silently falling back to Math.random (%s)", (_name, cryptoApi) => {
    // A silent fallback is how an unrandomised assignment reaches the record
    // wearing a label it did not earn.
    //
    // Note: passing `undefined` here would NOT exercise this path — it triggers
    // the default parameter and uses the real crypto. The absent-crypto case has
    // to be forced with a value that is present but useless.
    expect(() => drawOpponentOperation(cryptoApi)).toThrow(/unavailable/i);
  });

  it("reaches every menu option", () => {
    const seen = new Set();
    for (let value = 0; value < 8; value += 1) {
      seen.add(drawOpponentOperation({ getRandomValues: (a) => { a[0] = value; return a; } }).operation);
    }
    expect([...seen].sort()).toEqual(["C", "D", "M", "Q"]);
  });
});

describe("arena archive is separate from Phase 0", () => {
  it("round-trips plays under their own key", () => {
    const storage = memoryStorage();
    expect(appendArenaPlay(play(), storage)).toEqual({ ok: true, count: 1, error: null });
    expect(readArenaPlays(storage)).toHaveLength(1);
  });

  it("refuses anything that is not a play record", () => {
    // Validation item 10. An explanation sample or a Phase 0 decision event must
    // not be storable here — pooling them is precisely what the protocol bans.
    const storage = memoryStorage();
    const explanation = { schema: "quantum-arena-explanation/v1", shots: 4096 };
    const phaseZero = { schema: "ttt-decision/v1", selected_move: 4 };
    expect(appendArenaPlay(explanation, storage).ok).toBe(false);
    expect(appendArenaPlay(phaseZero, storage).ok).toBe(false);
    expect(readArenaPlays(storage)).toHaveLength(0);
  });

  it("does not read Phase 0 records even if they are somehow present", () => {
    const storage = memoryStorage();
    storage.setItem("governance-playground:quantum-arena-plays:v1",
      JSON.stringify([play(), { schema: "ttt-decision/v1" }]));
    expect(readArenaPlays(storage)).toHaveLength(1);
  });

  it("reports a storage failure instead of throwing", () => {
    const storage = { getItem: () => "[]", setItem: () => { throw new Error("quota"); } };
    expect(appendArenaPlay(play(), storage)).toEqual({ ok: false, count: 0, error: "quota" });
  });
});
