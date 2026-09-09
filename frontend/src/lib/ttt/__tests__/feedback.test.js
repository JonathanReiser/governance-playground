import { describe, expect, it } from "vitest";
import { analyzeFeedback, analyzeValidationSessions, fitFrozenModels, predictFrozen } from "../feedback";

const event = (move, values = { 0: 0, 1: 1, 2: -1 }) => ({
  schema: "ttt-decision/v1", legal_moves: [0, 1, 2], selected_move: move,
  minimax_action_values: values, response_ms: 100, player: "X",
  board_before: [0, 0, 0, 0, 0, 0, 0, 0, 0],
});

describe("feedback analysis", () => {
  it("uses every valid event and returns finite comparable losses", () => {
    const result = analyzeFeedback([event(1), event(1), event(0), event(1)]);
    expect(result.decisions).toBe(4);
    expect(result.models).toHaveLength(3);
    expect(result.models.every((model) => Number.isFinite(model.meanLogLoss))).toBe(true);
    expect(result.meanResponseMs).toBe(100);
  });

  it("ignores malformed observations rather than inventing choices", () => {
    expect(analyzeFeedback([{ legal_moves: [0], selected_move: 8 }]).decisions).toBe(0);
  });

  it("freezes training parameters and scores a later choice without updating them", () => {
    const snapshot = fitFrozenModels([event(1), event(1), event(0)]);
    const prediction = predictFrozen(event(2), snapshot);
    expect(snapshot.training_decisions).toBe(3);
    expect(Object.values(prediction).filter(Number.isFinite).every((value) => value > 0 && value <= 1)).toBe(true);
    expect(predictFrozen(event(2), snapshot)).toEqual(prediction);
    expect(prediction.classical_context).toBeGreaterThan(0);
    expect(prediction.quantum_context).toBeGreaterThan(0);
    expect(prediction.classical_envelope).toBeUndefined();
    expect(prediction.contextual_version).toBe("ttt-context-models/v4-context-only");
  });

  it("refuses an uncertainty interval with fewer than eight sessions", () => {
    const decisions = (classical, quantum) => [{ modelPredictions: { classical_strategy: Math.exp(-classical), quantum_style: Math.exp(-quantum) } }];
    const result = analyzeValidationSessions([
      { session_id: "a", decisions: decisions(1, 1.2) },
      { session_id: "b", decisions: decisions(1.1, 1.3) },
      { session_id: "c", decisions: decisions(0.9, 1.1) },
    ]);
    expect(result.rows).toHaveLength(3);
    expect(result.difference).toBeCloseTo(0.2);
    expect(result.interval).toBeNull();
  });

  it("never pools different model versions", () => {
    const v1 = { modelPredictions: { classical_strategy: 0.8, quantum_style: 0.2 } };
    const v2 = { modelPredictions: { classical_strategy: 0.2, quantum_style: 0.8, classical_context: 0.2, quantum_context: 0.8 } };
    const result = analyzeValidationSessions([
      { session_id: "old", decisions: [v1] },
      { session_id: "new", decisions: [v2] },
    ]);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].version).toBe("v1 baseline");
    expect(result.groups[1].version).toBe("v2 context diagnostic");
    expect(result.groups[0].difference).toBeGreaterThan(0);
    expect(result.groups[1].difference).toBeLessThan(0);
  });

  it("quarantines historical free-envelope scores instead of reporting their comparison", () => {
    const predictions = {
      classical_strategy: 0.2, quantum_style: 0.2,
      classical_context: 0.3, quantum_context: 0.4, classical_envelope: 0.5,
    };
    const result = analyzeValidationSessions([{ session_id: "v3", decisions: [{ modelPredictions: predictions }] }]);
    expect(result.version).toBe("v3 envelope quarantined");
    expect(result.envelopeGap).toBeNull();
  });
});
