import { describe, expect, it } from "vitest";
import {
  amplitudeWeight, contextFeatures, contextualProbabilities, expandedAmplitudeWeight, fitContextualModels,
  fitEnvelopeModel, freeEnvelopeWeight, predictContextual,
} from "../contextual";
import { actionValues, isTerminal, legalMoves, reachableStates } from "../game";

const position = {
  board_before: [1, 1, 0, -1, -1, 0, 0, 0, 0], player: "X",
  legal_moves: [2, 5, 6, 7, 8], selected_move: 2,
  minimax_action_values: { 2: 1, 5: 0, 6: -1, 7: -1, 8: -1 },
};

describe("contextual models", () => {
  it("recognizes an immediate winning move", () => {
    expect(contextFeatures(position, 2).slice(0, 2)).toEqual([1, 1]);
  });

  it("rejects a missing player instead of silently treating it as X", () => {
    expect(() => contextFeatures({ ...position, player: undefined }, 2)).toThrow(/player/);
  });

  it("pins the exact real-valued reduction of the amplitude formula", () => {
    for (const base of [0.1, 0.4, 1]) {
      for (const reason of [0.1, 1, 3]) {
        for (const angle of [-Math.PI / 2, -0.2, 0, 0.7, Math.PI / 2]) {
          expect(amplitudeWeight(base, reason, angle)).toBeCloseTo(expandedAmplitudeWeight(base, reason, angle), 12);
        }
      }
    }
  });

  it("is monotone in its positive reason over the constrained phase range", () => {
    for (const angle of [-Math.PI / 2, -0.5, 0, 0.5, Math.PI / 2]) {
      expect(amplitudeWeight(0.4, 2, angle)).toBeGreaterThan(amplitudeWeight(0.4, 1, angle));
    }
  });

  it("nests the amplitude constraint exactly inside the free classical envelope", () => {
    for (const base of [0.1, 0.4, 1]) {
      for (const reason of [0.1, 1, 3]) {
        for (const angle of [-Math.PI / 2, -0.2, 0, 0.7, Math.PI / 2]) {
          expect(freeEnvelopeWeight(base, reason, angle, 0, 1)).toBeCloseTo(amplitudeWeight(base, reason, angle), 12);
        }
      }
    }
  });

  it("fits the two context predictors while the failed envelope diagnostic is quarantined", () => {
    const snapshot = fitContextualModels([position, position, { ...position, selected_move: 5 }]);
    expect(snapshot.schema).toBe("ttt-context-models/v4-context-only");
    expect(snapshot.classical.weights).toHaveLength(6);
    expect(snapshot.amplitude.weights).toHaveLength(6);
    expect(snapshot.envelope).toBeUndefined();
    const prediction = predictContextual(position, snapshot);
    expect(Object.values(prediction).every((value) => value > 0 && value <= 1)).toBe(true);
    expect(prediction.classical_envelope).toBeUndefined();
    // Same freeze property as feedback.test.js: the snapshot must be inert under
    // use. Score every other legal choice in this position, then re-score the
    // original and require both the prediction and the snapshot to be unchanged.
    const before = JSON.parse(JSON.stringify(snapshot));
    for (const selected_move of position.legal_moves) {
      predictContextual({ ...position, selected_move }, snapshot);
    }
    expect(predictContextual(position, snapshot)).toEqual(prediction);
    expect(snapshot).toEqual(before);
  });

  it("recovers known couplings at the synthetic population limit", () => {
    const counts = [13, 8, 12, 7, 18, 6, 11, 9, 10];
    const candidates = reachableStates().filter((state) => !isTerminal(state) && legalMoves(state).length >= 3);
    const contexts = Array.from({ length: 80 }, (_, index) => candidates[Math.floor(index * candidates.length / 80)]);
    for (const coupling of [-0.5, 0, 0.5, 1]) {
      const truth = {
        kind: "free-envelope-v4",
        weights: [0.8, 0.45, 0.35, 0.3, 0.2, -0.15],
        phase: 0.65,
        logReasonScale: -0.35,
        coupling,
      };
      const synthetic = contexts.flatMap((state) => {
        const template = {
          board_before: [...state.board],
          player: state.toMove === 1 ? "X" : "O",
          legal_moves: legalMoves(state),
          minimax_action_values: actionValues(state),
        };
        return contextualProbabilities(template, truth, counts).map((probability, moveIndex) => ({
          ...template,
          selected_move: template.legal_moves[moveIndex],
          observation_weight: 60 * probability,
        }));
      });
      expect(fitEnvelopeModel(synthetic, counts).coupling).toBeCloseTo(coupling, 1);
    }
  }, 60000);
});
