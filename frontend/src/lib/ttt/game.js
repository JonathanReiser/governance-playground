export const X = 1;
export const O = -1;
export const EMPTY = 0;

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function initialState() {
  return { board: Array(9).fill(EMPTY), toMove: X };
}

export function winner(state) {
  for (const [a, b, c] of LINES) {
    if (state.board[a] !== EMPTY && state.board[a] === state.board[b] && state.board[a] === state.board[c]) {
      return state.board[a];
    }
  }
  return null;
}

export function isTerminal(state) {
  return winner(state) !== null || !state.board.includes(EMPTY);
}

export function legalMoves(state) {
  if (isTerminal(state)) return [];
  return state.board.flatMap((cell, index) => cell === EMPTY ? [index] : []);
}

export function applyMove(state, move) {
  if (!Number.isInteger(move) || move < 0 || move > 8) throw new Error("Move must be an integer from 0 through 8.");
  if (isTerminal(state)) throw new Error("The game is already over.");
  if (state.board[move] !== EMPTY) throw new Error("That square is occupied.");
  const board = [...state.board];
  board[move] = state.toMove;
  return { board, toMove: -state.toMove };
}

export function utility(state, perspective) {
  if (!isTerminal(state)) throw new Error("Utility is defined only for terminal states.");
  const victor = winner(state);
  return victor === null ? 0 : victor === perspective ? 1 : -1;
}

const valueCache = new Map();

export function stateValue(state) {
  const key = `${state.toMove}:${state.board.join(",")}`;
  if (valueCache.has(key)) return valueCache.get(key);
  if (isTerminal(state)) return utility(state, state.toMove);
  const computed = Math.max(...legalMoves(state).map((move) => -stateValue(applyMove(state, move))));
  const value = Object.is(computed, -0) ? 0 : computed;
  valueCache.set(key, value);
  return value;
}

export function actionValues(state) {
  if (isTerminal(state)) throw new Error("A terminal state has no actions.");
  return Object.fromEntries(legalMoves(state).map((move) => [move, -stateValue(applyMove(state, move))]));
}

export function minimaxMove(state) {
  const values = actionValues(state);
  const best = Math.max(...Object.values(values));
  return Number(Object.keys(values).find((move) => values[move] === best));
}

export function samplePerfectMove(state, randomValue) {
  const values = actionValues(state);
  const best = Math.max(...Object.values(values));
  const moves = Object.keys(values).map(Number).filter((move) => values[move] === best);
  if (!Number.isInteger(randomValue) || randomValue < 0) throw new Error("randomValue must be a nonnegative integer.");
  return { move: moves[randomValue % moves.length], optimalMoves: moves };
}

/**
 * Discounted-outcome value, mirroring python-bridge/ttt_lab/policies/depth_aware.py
 * exactly. Terminal states keep their {-1, 0, 1} utility; every ply back multiplies
 * by DISCOUNT, so a win taken sooner scores higher than the same win taken later and
 * a loss delayed scores higher than the same loss taken at once. Outcome classes are
 * preserved: every win stays positive, every draw exactly 0, every loss negative —
 * verified over all 16,167 (state, move) pairs.
 */
export const DISCOUNT = 0.9;

const discountedCache = new Map();

export function discountedValue(state) {
  const key = `${state.toMove}:${state.board.join(",")}`;
  if (discountedCache.has(key)) return discountedCache.get(key);
  if (isTerminal(state)) return utility(state, state.toMove);
  const computed = Math.max(...legalMoves(state).map((move) => -DISCOUNT * discountedValue(applyMove(state, move))));
  const value = Object.is(computed, -0) ? 0 : computed;
  discountedCache.set(key, value);
  return value;
}

export function discountedActionValues(state) {
  if (isTerminal(state)) throw new Error("A terminal state has no actions.");
  return Object.fromEntries(legalMoves(state).map((move) => {
    // Negating a drawn child yields -0, which compares equal to 0 but is a distinct
    // value under Object.is and to any exact-equality grouping. stateValue() and
    // discountedValue() already normalise it; this negation happens outside both.
    const value = -DISCOUNT * discountedValue(applyMove(state, move));
    return [move, Object.is(value, -0) ? 0 : value];
  }));
}

export function analyzeChoice(state, move) {
  const values = actionValues(state);
  if (!(move in values)) throw new Error("Choice must be a legal move.");
  const bestValue = Math.max(...Object.values(values));
  const selectedValue = values[move];
  const optimalMoves = Object.entries(values).filter(([, value]) => value === bestValue).map(([index]) => Number(index));
  const regret = bestValue - selectedValue;
  let errorType = null;
  if (regret > 0) {
    if (bestValue === 1 && selectedValue === 0) errorType = "missed-win-to-draw";
    else if (bestValue === 1 && selectedValue === -1) errorType = "missed-win-to-loss";
    else if (bestValue === 0 && selectedValue === -1) errorType = "surrendered-draw";
    else throw new Error(`Unexpected minimax transition ${bestValue} -> ${selectedValue}.`);
  }

  // Tempo is reported ALONGSIDE outcome regret, never folded into it. Outcome-class
  // regret deliberately ignores how quickly a forced win is taken or how long a
  // forced loss is delayed (see python-bridge/ttt_lab/README.md); this is the
  // separate measure of exactly that, and it must never be summed with `regret` or
  // labelled as outcome regret. Every session recorded before this field existed
  // remains directly comparable on `regret`, which is unchanged.
  const tempoValues = discountedActionValues(state);
  const bestTempo = Math.max(...Object.values(tempoValues));
  const selectedTempo = tempoValues[move];
  const tempoOptimalMoves = Object.entries(tempoValues)
    .filter(([, value]) => Math.abs(value - bestTempo) < 1e-12)
    .map(([index]) => Number(index));
  const tempoRegret = bestTempo - selectedTempo;

  return {
    move,
    optimalMoves,
    selectedValue,
    bestValue,
    regret,
    errorType,
    tempo: {
      discount: DISCOUNT,
      bestValue: bestTempo,
      selectedValue: selectedTempo,
      optimalMoves: tempoOptimalMoves,
      // > 0 only when the choice was outcome-optimal but slower; a choice that also
      // changed the outcome class already shows up in `regret`.
      regret: tempoRegret,
      slowerWithinOutcomeClass: regret === 0 && tempoRegret > 1e-12,
    },
  };
}

export function softmaxDistribution(state, temperature) {
  if (typeof temperature !== "number" || Number.isNaN(temperature) || temperature < 0) {
    throw new Error("Temperature must be a nonnegative number.");
  }
  const values = actionValues(state);
  const moves = Object.keys(values).map(Number);
  const scores = moves.map((move) => values[move]);
  if (temperature === 0) {
    const best = Math.max(...scores);
    const tied = scores.filter((score) => score === best).length;
    return moves.map((move) => ({ move, value: values[move], probability: values[move] === best ? 1 / tied : 0 }));
  }
  if (temperature === Infinity) {
    return moves.map((move) => ({ move, value: values[move], probability: 1 / moves.length }));
  }
  const logits = scores.map((score) => score / temperature);
  const maxLogit = Math.max(...logits);
  const weights = logits.map((logit) => Math.exp(logit - maxLogit));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return moves.map((move, index) => ({ move, value: values[move], probability: weights[index] / total }));
}

export function reachableStates() {
  const found = new Map();
  function visit(state) {
    const key = `${state.toMove}:${state.board.join(",")}`;
    if (found.has(key)) return;
    found.set(key, state);
    for (const move of legalMoves(state)) visit(applyMove(state, move));
  }
  visit(initialState());
  return [...found.values()];
}
