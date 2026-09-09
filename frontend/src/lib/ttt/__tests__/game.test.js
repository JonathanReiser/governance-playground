import { describe, expect, it } from "vitest";
import fixture from "./depth-aware-fixture.json";
import {
  X, actionValues, analyzeChoice, applyMove, initialState, isTerminal, legalMoves, minimaxMove,
  reachableStates, samplePerfectMove, softmaxDistribution, stateValue, winner,
  DISCOUNT, discountedActionValues, discountedValue,
} from "../game";

function play(...moves) {
  return moves.reduce((state, move) => applyMove(state, move), initialState());
}

describe("tic-tac-toe rules", () => {
  it("enumerates every reachable state once", () => {
    expect(reachableStates()).toHaveLength(5478);
  });

  it("detects a win and refuses later moves", () => {
    const state = play(0, 3, 1, 4, 2);
    expect(winner(state)).toBe(X);
    expect(isTerminal(state)).toBe(true);
    expect(legalMoves(state)).toEqual([]);
    expect(() => applyMove(state, 8)).toThrow(/already over/);
  });
});

describe("minimax oracle", () => {
  it("samples only from the complete tied optimal set", () => {
    const sampled = [0, 1, 2, 3].map((draw) => samplePerfectMove(initialState(), draw));
    expect(sampled.every(({ move, optimalMoves }) => optimalMoves.includes(move))).toBe(true);
    expect(new Set(sampled.map(({ move }) => move)).size).toBeGreaterThan(1);
  });
  it("values the initial position as a draw", () => {
    expect(stateValue(initialState())).toBe(0);
  });

  it("takes a win and blocks the only forced loss", () => {
    expect(minimaxMove(play(0, 3, 1, 4))).toBe(2);
    expect(minimaxMove(play(0, 3, 8, 4))).toBe(5);
  });

  it("matches the exact reachable-state value census", () => {
    const counts = { "-1": 0, 0: 0, 1: 0 };
    for (const state of reachableStates()) {
      if (!isTerminal(state)) counts[stateValue(state)] += 1;
    }
    expect(counts).toEqual({ "-1": 632, 0: 1052, 1: 2836 });
  });

  it("does not call tied perfect moves errors", () => {
    const analysis = analyzeChoice(initialState(), 4);
    expect(analysis.regret).toBe(0);
    expect(analysis.errorType).toBeNull();
    expect(analysis.optimalMoves).toContain(4);
  });

  it("classifies a surrendered draw", () => {
    const state = play(0, 4, 8);
    const errors = legalMoves(state).map((move) => analyzeChoice(state, move)).filter(({ errorType }) => errorType === "surrendered-draw");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].regret).toBe(1);
  });

  it("matches the exact choice-taxonomy census", () => {
    const counts = { optimal: 0, "missed-win-to-loss": 0, "surrendered-draw": 0, "missed-win-to-draw": 0 };
    for (const state of reachableStates()) {
      if (isTerminal(state)) continue;
      for (const move of legalMoves(state)) {
        counts[analyzeChoice(state, move).errorType ?? "optimal"] += 1;
      }
    }
    expect(counts).toEqual({ optimal: 8863, "missed-win-to-loss": 3816, "surrendered-draw": 2104, "missed-win-to-draw": 1384 });
  });
});

describe("softmax policy", () => {
  it("has exact cold and hot limits", () => {
    const state = play(0, 3, 1, 4);
    const cold = softmaxDistribution(state, 0);
    const hot = softmaxDistribution(state, Infinity);
    expect(cold.find(({ move }) => move === 2).probability).toBe(1);
    for (const entry of hot) expect(entry.probability).toBeCloseTo(1 / hot.length, 12);
  });
});

describe("discounted-outcome (tempo) scoring", () => {
  it("agrees with the Python depth_aware oracle on every fixture case", () => {
    expect(fixture.discount).toBe(DISCOUNT);
    expect(fixture.cases).toHaveLength(120);
    for (const testCase of fixture.cases) {
      const state = { board: testCase.board, toMove: testCase.toMove };
      const actual = discountedActionValues(state);
      for (const [move, expected] of Object.entries(testCase.scores)) {
        expect(actual[move]).toBeCloseTo(expected, 12);
      }
    }
  });

  it("preserves outcome classes over every reachable position", () => {
    for (const state of reachableStates()) {
      if (isTerminal(state)) continue;
      const outcome = actionValues(state);
      const tempo = discountedActionValues(state);
      for (const move of Object.keys(outcome)) {
        if (outcome[move] > 0) expect(tempo[move]).toBeGreaterThan(0);
        else if (outcome[move] < 0) expect(tempo[move]).toBeLessThan(0);
        else expect(tempo[move]).toBe(0);
      }
    }
  });

  it("prefers the faster win and the slower loss", () => {
    // X to move, winning at 6 immediately or at 2 with a longer line.
    const fasterWin = play(0, 3, 1, 4, 7);
    const tempo = discountedActionValues(fasterWin);
    const outcome = actionValues(fasterWin);
    const winning = Object.keys(outcome).filter((move) => outcome[move] === 1);
    expect(winning.length).toBeGreaterThan(0);
    // every winning move is scored above every non-winning one
    for (const win of winning) {
      for (const other of Object.keys(outcome).filter((move) => outcome[move] < 1)) {
        expect(tempo[win]).toBeGreaterThan(tempo[other]);
      }
    }
  });

  it("reports tempo separately and never folds it into outcome regret", () => {
    const state = play(0, 4, 8, 1);
    for (const move of legalMoves(state)) {
      const analysis = analyzeChoice(state, move);
      expect(analysis.regret).toBe(analysis.bestValue - analysis.selectedValue);
      expect(analysis.tempo.discount).toBe(DISCOUNT);
      expect(analysis.tempo.regret).toBeGreaterThanOrEqual(-1e-12);
      // a tempo-only miss must not disturb the outcome-class regret
      if (analysis.tempo.slowerWithinOutcomeClass) expect(analysis.regret).toBe(0);
    }
  });

  it("keeps every discounted value inside [-1, 1] and draws exactly zero", () => {
    for (const state of reachableStates()) {
      if (isTerminal(state)) continue;
      for (const value of Object.values(discountedActionValues(state))) {
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    expect(discountedValue(initialState())).toBe(0);
  });
});
