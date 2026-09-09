import { describe, expect, it } from "vitest";
import {
  X, analyzeChoice, applyMove, initialState, isTerminal, legalMoves, minimaxMove,
  reachableStates, samplePerfectMove, softmaxDistribution, stateValue, winner,
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
