const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6],
  [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6],
];

const NAMES = ["game value", "win now", "block loss", "create fork", "center", "corner"];

function playerValue(event) {
  if (event.player === "X") return 1;
  if (event.player === "O") return -1;
  throw new Error("recorded player must be X or O");
}

function wins(board, player) {
  return LINES.some(([a, b, c]) => board[a] === player && board[b] === player && board[c] === player);
}

function winningMoves(board, player) {
  return board.flatMap((cell, move) => {
    if (cell !== 0) return [];
    const next = [...board];
    next[move] = player;
    return wins(next, player) ? [move] : [];
  });
}

export function contextFeatures(event, move) {
  if (!Array.isArray(event.board_before) || event.board_before.length !== 9 || !event.legal_moves?.includes(move)) {
    throw new Error("context features require a valid recorded position and legal move");
  }
  const player = playerValue(event);
  const opponentThreats = winningMoves(event.board_before, -player);
  const after = [...event.board_before];
  after[move] = player;
  return [
    Number(event.minimax_action_values[move]),
    wins(after, player) ? 1 : 0,
    opponentThreats.includes(move) ? 1 : 0,
    winningMoves(after, player).length >= 2 ? 1 : 0,
    move === 4 ? 1 : 0,
    [0, 2, 6, 8].includes(move) ? 1 : 0,
  ];
}

/**
 * Fixed-weight heuristic baseline, mirroring python-bridge/ttt_lab/policies/features.py.
 *
 * Its five features are exactly contextFeatures(...).slice(1) — the same five in the
 * same order — so this reuses that verified implementation rather than carrying a
 * second copy that could drift. Only the game-value term is dropped: this baseline
 * deliberately knows nothing about the minimax oracle.
 *
 * WHY IT IS NOT FITTED, and must not be. The classical context model already uses
 * these five features plus game value plus square propensity, all fitted. A fitted
 * feature policy would be a strictly weaker duplicate of it and would tell us
 * nothing new. The value of this baseline is precisely that it carries ZERO free
 * parameters: it cannot overfit, its held-out score equals its training score by
 * construction, and it is a genuine out-of-sample predictor from the first move.
 *
 * That makes it the honest floor for the fitted models to clear. If seven fitted
 * parameters cannot beat a stipulated textbook heuristic, the fitting is not
 * earning its place.
 *
 * The weights are stipulated, not estimated, and ttt_lab/README.md is explicit
 * that they "must be fit and evaluated out of sample before drawing conclusions".
 * Fitting them is a separate, preregisterable decision — not something to slip in
 * by editing these constants.
 */
export const HEURISTIC_WEIGHTS = [6.0, 5.0, 3.0, 1.5, 0.8];
export const HEURISTIC_TEMPERATURE = 1.0;

export function heuristicProbabilities(event, temperature = HEURISTIC_TEMPERATURE) {
  if (!(typeof temperature === "number") || Number.isNaN(temperature) || temperature <= 0) {
    throw new Error("temperature must be positive");
  }
  const scores = event.legal_moves.map((move) => {
    const [, winNow, blockLoss, createFork, center, corner] = contextFeatures(event, move);
    // One deliberate divergence from contextFeatures, and it is not a typo.
    // features.py evaluates forks on the position AFTER the move, where a winning
    // move has already ended the game — so legal_moves is empty there and the fork
    // feature is 0. contextFeatures instead scans empty squares without checking
    // for termination, so a winning move scores BOTH win and fork.
    //
    // Both conventions are defensible and the difference is invisible to a fitted
    // model, which simply redistributes weight between two co-occurring features.
    // It is NOT invisible here: the weights are stipulated, so a winning move would
    // score 6.0 + 3.0 instead of 6.0 and this baseline would stop matching the
    // Python policy it claims to mirror.
    //
    // Suppressed here rather than fixed in contextFeatures on purpose. Changing
    // that function would alter the fitted classical/amplitude context features and
    // silently break comparability with every session already recorded.
    const features = [winNow, blockLoss, winNow ? 0 : createFork, center, corner];
    return features.reduce((sum, value, index) => sum + HEURISTIC_WEIGHTS[index] * value, 0) / temperature;
  });
  const peak = Math.max(...scores);
  const weights = scores.map((score) => Math.exp(score - peak));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((weight) => weight / total);
}

function dot(weights, features) {
  return weights.reduce((sum, weight, index) => sum + weight * features[index], 0);
}

export function amplitudeWeight(base, positiveReason, angle) {
  return (base * Math.cos(angle) + positiveReason) ** 2 + (base * Math.sin(angle)) ** 2;
}

export function expandedAmplitudeWeight(base, positiveReason, angle) {
  return base ** 2 + 2 * base * positiveReason * Math.cos(angle) + positiveReason ** 2;
}

export function freeEnvelopeWeight(base, positiveReason, angle, logReasonScale, coupling) {
  const reasonScale = Math.exp(Math.max(-6, Math.min(6, logReasonScale)));
  const boundedCoupling = Math.max(-1, Math.min(1, coupling));
  return base ** 2
    + 2 * boundedCoupling * Math.sqrt(reasonScale) * base * positiveReason * Math.cos(angle)
    + reasonScale * positiveReason ** 2;
}

export function contextualProbabilities(event, model, counts) {
  const mass = event.legal_moves.reduce((sum, move) => sum + counts[move], 0);
  if (model.kind === "classical-context-v2") {
    const logits = event.legal_moves.map((move) => dot(model.weights, contextFeatures(event, move)) + model.propensity * Math.log(counts[move] / mass));
    const peak = Math.max(...logits);
    const values = logits.map((value) => Math.exp(value - peak));
    const total = values.reduce((a, b) => a + b, 0);
    return values.map((value) => value / total);
  }
  const values = event.legal_moves.map((move) => {
    const base = Math.sqrt(counts[move] / mass);
    const angle = model.phase * (move - 4) / 4;
    const reason = Math.exp(Math.max(-10, Math.min(10, dot(model.weights, contextFeatures(event, move)) / 2)));
    if (model.kind.startsWith("free-envelope-")) {
      return freeEnvelopeWeight(base, reason, angle, model.logReasonScale, model.coupling) + 1e-12;
    }
    return amplitudeWeight(base, reason, angle) + 1e-12;
  });
  const total = values.reduce((a, b) => a + b, 0);
  return values.map((value) => value / total);
}

function loss(events, model, counts) {
  let total = 0;
  for (const event of events) {
    const probabilities = contextualProbabilities(event, model, counts);
    total -= Math.log(Math.max(probabilities[event.legal_moves.indexOf(event.selected_move)], 1e-12));
  }
  const parameters = model.kind === "classical-context-v2"
    ? [...model.weights, model.propensity]
    : model.kind.startsWith("free-envelope-")
      ? [...model.weights, model.phase, model.logReasonScale]
      : [...model.weights, model.phase];
  const fixedPriorPenalty = 0.002 * parameters.reduce((sum, value) => sum + value * value, 0);
  return (total + fixedPriorPenalty) / events.length;
}

function coordinateCount(kind) {
  return kind.startsWith("free-envelope-") ? 9 : 7;
}

function moveCoordinate(candidate, index, direction, step) {
  if (index < 6) {
    candidate.weights[index] += direction * step;
  } else if (candidate.kind === "classical-context-v2") {
    candidate.propensity += direction * step;
  } else if (index === 6) {
    candidate.phase = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, candidate.phase + direction * step));
  } else if (index === 7) {
    candidate.logReasonScale = Math.max(-6, Math.min(6, candidate.logReasonScale + direction * step));
  } else {
    candidate.coupling = Math.max(-1, Math.min(1, candidate.coupling + direction * step));
  }
}

function optimizeFrom(events, startingModel, counts) {
  let model = startingModel;
  const kind = model.kind;
  let best = loss(events, model, counts);
  for (const step of [1, 0.5, 0.25, 0.1]) {
    for (let pass = 0; pass < 3; pass += 1) {
      for (let index = 0; index < coordinateCount(kind); index += 1) {
        for (const direction of [-1, 1]) {
          const candidate = { ...model, weights: [...model.weights] };
          moveCoordinate(candidate, index, direction, step);
          const candidateLoss = loss(events, candidate, counts);
          if (candidateLoss < best) {
            model = candidate;
            best = candidateLoss;
          }
        }
      }
    }
  }
  return model;
}

function optimize(events, kind, counts, extraStarts = []) {
  const starts = kind === "classical-context-v2"
    ? [-1, 0, 1].map((propensity) => ({ kind, weights: [1, 0, 0, 0, 0, 0], propensity }))
    : kind.startsWith("free-envelope-")
      ? [
        { kind, weights: [1, 0, 0, 0, 0, 0], phase: -Math.PI / 2, logReasonScale: 0, coupling: -1 },
        { kind, weights: [1, 0, 0, 0, 0, 0], phase: 0, logReasonScale: 0, coupling: 0 },
        { kind, weights: [1, 0, 0, 0, 0, 0], phase: Math.PI / 2, logReasonScale: 0, coupling: 1 },
      ]
      : [-Math.PI / 2, 0, Math.PI / 2].map((phase) => ({ kind, weights: [1, 0, 0, 0, 0, 0], phase }));
  return [...extraStarts, ...starts]
    .map((model) => optimizeFrom(events, model, counts))
    .sort((a, b) => loss(events, a, counts) - loss(events, b, counts))[0];
}

const ENVELOPE_BOUNDS = [
  [-8, 8], [-8, 8], [-8, 8], [-8, 8], [-8, 8], [-8, 8],
  [-Math.PI / 2, Math.PI / 2], [-6, 6], [-1, 1],
];

function envelopeVector(model) {
  return [...model.weights, model.phase, model.logReasonScale, model.coupling];
}

function envelopeModel(vector) {
  return {
    kind: "free-envelope-v4",
    weights: vector.slice(0, 6),
    phase: vector[6],
    logReasonScale: vector[7],
    coupling: vector[8],
  };
}

function prepareEnvelopeData(events, counts) {
  return events.map((event) => {
    const mass = event.legal_moves.reduce((sum, move) => sum + counts[move], 0);
    return {
      chosen: event.legal_moves.indexOf(event.selected_move),
      weight: Number.isFinite(event.observation_weight) && event.observation_weight > 0 ? event.observation_weight : 1,
      moves: event.legal_moves.map((move) => ({
        features: contextFeatures(event, move),
        base: Math.sqrt(counts[move] / mass),
        position: (move - 4) / 4,
      })),
    };
  });
}

function envelopeObjectiveAndGradient(prepared, vector) {
  const gradient = Array(9).fill(0);
  let totalLoss = 0;
  const weights = vector.slice(0, 6);
  const phase = vector[6];
  const logReasonScale = vector[7];
  const coupling = vector[8];
  const reasonAmplitudeScale = Math.exp(logReasonScale / 2);
  const reasonScale = reasonAmplitudeScale ** 2;
  const totalWeight = prepared.reduce((sum, event) => sum + event.weight, 0);
  for (const event of prepared) {
    const terms = event.moves.map(({ features, base, position }) => {
      const angle = phase * position;
      const rawLogReason = dot(weights, features) / 2;
      const logReason = Math.max(-10, Math.min(10, rawLogReason));
      const reason = Math.exp(logReason);
      const cosine = Math.cos(angle);
      const value = base ** 2
        + 2 * coupling * reasonAmplitudeScale * base * reason * cosine
        + reasonScale * reason ** 2
        + 1e-12;
      const derivatives = Array(9).fill(0);
      if (rawLogReason > -10 && rawLogReason < 10) {
        for (let index = 0; index < 6; index += 1) {
          derivatives[index] = features[index] * (
            coupling * reasonAmplitudeScale * base * reason * cosine
            + reasonScale * reason ** 2
          );
        }
      }
      derivatives[6] = -2 * coupling * reasonAmplitudeScale * base * reason * Math.sin(angle) * position;
      derivatives[7] = coupling * reasonAmplitudeScale * base * reason * cosine + reasonScale * reason ** 2;
      derivatives[8] = 2 * reasonAmplitudeScale * base * reason * cosine;
      return { value, logDerivatives: derivatives.map((derivative) => derivative / value) };
    });
    const normalizer = terms.reduce((sum, term) => sum + term.value, 0);
    totalLoss -= event.weight * Math.log(terms[event.chosen].value / normalizer);
    for (let parameter = 0; parameter < gradient.length; parameter += 1) {
      const expected = terms.reduce((sum, term) => sum + term.value / normalizer * term.logDerivatives[parameter], 0);
      gradient[parameter] += event.weight * (expected - terms[event.chosen].logDerivatives[parameter]);
    }
  }
  // This is a fixed weak prior on nuisance parameters, so its per-observation
  // effect vanishes. Coupling is the scientific parameter and is never penalized.
  for (let parameter = 0; parameter < 8; parameter += 1) {
    totalLoss += 0.002 * vector[parameter] ** 2;
    gradient[parameter] += 0.004 * vector[parameter];
  }
  return {
    value: totalLoss / totalWeight,
    gradient: gradient.map((entry) => entry / totalWeight),
  };
}

function optimizeEnvelopeFrom(prepared, startingModel) {
  let vector = envelopeVector(startingModel);
  let bestVector = [...vector];
  let best = envelopeObjectiveAndGradient(prepared, vector).value;
  const firstMoment = Array(9).fill(0);
  const secondMoment = Array(9).fill(0);
  let unchanged = 0;
  for (let iteration = 1; iteration <= 700 && unchanged < 160; iteration += 1) {
    const objective = envelopeObjectiveAndGradient(prepared, vector);
    const learningRate = 0.04 * (1 - 0.7 * iteration / 700);
    for (let parameter = 0; parameter < vector.length; parameter += 1) {
      firstMoment[parameter] = 0.9 * firstMoment[parameter] + 0.1 * objective.gradient[parameter];
      secondMoment[parameter] = 0.999 * secondMoment[parameter] + 0.001 * objective.gradient[parameter] ** 2;
      const correctedFirst = firstMoment[parameter] / (1 - 0.9 ** iteration);
      const correctedSecond = secondMoment[parameter] / (1 - 0.999 ** iteration);
      vector[parameter] -= learningRate * correctedFirst / (Math.sqrt(correctedSecond) + 1e-8);
      vector[parameter] = Math.max(ENVELOPE_BOUNDS[parameter][0], Math.min(ENVELOPE_BOUNDS[parameter][1], vector[parameter]));
    }
    const candidate = envelopeObjectiveAndGradient(prepared, vector).value;
    if (candidate < best - 1e-10) {
      best = candidate;
      bestVector = [...vector];
      unchanged = 0;
    } else {
      unchanged += 1;
    }
  }
  return envelopeModel(bestVector);
}

/**
 * QUARANTINED — do not wire this into the prediction path.
 *
 * The free envelope nests the amplitude constraint exactly at coupling = 1, so in
 * principle it is the right way to ask whether that constraint is doing any work.
 * The estimator recovers `coupling` only at the POPULATION LIMIT — that is, when it
 * is handed every legal move weighted by its exact probability, as
 * contextual.test.js's recovery test does. That test is honest about its own scope
 * and passes.
 *
 * On finite SAMPLED data at any realistic session size, `coupling` is not
 * identified. Fitting synthetic draws generated from this very function:
 *
 *   n=140   true -0.5 -> fitted -0.66, -0.99, -0.98
 *           true  0   -> fitted  1.00, -0.91, -0.91
 *   n=600   true -0.5 -> fitted  1.00,  1.00,  1.00
 *           true  1   -> fitted  1.00, -0.77,  1.00
 *
 * Wrong sign in a majority of runs, and more data does not help — the optimiser
 * lands on the +/-1 bounds because the likelihood is nearly flat in coupling
 * (~0.015 nats across the whole range at n=600). Removing the L2 penalty on
 * coupling did not change this; the parameter is genuinely unidentified, not
 * merely over-regularised.
 *
 * A six-game research session yields roughly 30 decisions, which is far below even
 * the failing cases above. Reporting an envelope-versus-amplitude comparison from
 * data of that size would produce a confident-looking answer that does not depend
 * on the truth. That is why `fitContextualModels` no longer returns an envelope and
 * `predictContextual` no longer emits `classical_envelope`.
 *
 * Kept because the nesting is correct and the population-limit behaviour is worth
 * preserving. Before re-enabling it anywhere, make finite-sample recovery a passing
 * test at the n you actually intend to collect.
 */
export function fitEnvelopeModel(events, counts, amplitudeStart = null) {
  const prepared = prepareEnvelopeData(events, counts);
  const starts = [-1, -0.5, 0, 0.5, 1].map((coupling, index) => ({
    kind: "free-envelope-v4",
    weights: [1, 0, 0, 0, 0, 0],
    phase: [-1, -0.5, 0, 0.5, 1][index] * Math.PI / 2,
    logReasonScale: 0,
    coupling,
  }));
  if (amplitudeStart) {
    starts.push({
      kind: "free-envelope-v4",
      weights: [...amplitudeStart.weights],
      phase: amplitudeStart.phase,
      logReasonScale: 0,
      coupling: 1,
    });
  }
  return starts
    .map((start) => optimizeEnvelopeFrom(prepared, start))
    .sort((a, b) => (
      envelopeObjectiveAndGradient(prepared, envelopeVector(a)).value
      - envelopeObjectiveAndGradient(prepared, envelopeVector(b)).value
    ))[0];
}

export function fitContextualModels(events) {
  const usable = events.filter((event) =>
    Array.isArray(event.board_before)
    && event.board_before.length === 9
    && ["X", "O"].includes(event.player)
    && event.legal_moves?.includes(event.selected_move)
    && event.minimax_action_values
  );
  if (!usable.length) return null;
  const counts = Array(9).fill(1);
  for (const event of usable) counts[event.selected_move] += 1;
  const classical = optimize(usable, "classical-context-v2", counts);
  const amplitude = optimize(usable, "amplitude-constraint-v3", counts);
  return {
    schema: "ttt-context-models/v4-context-only",
    trainingDecisions: usable.length,
    featureNames: NAMES,
    counts,
    classical,
    amplitude,
  };
}

export function predictContextual(event, snapshot) {
  if (!snapshot || !event.legal_moves?.includes(event.selected_move)) return null;
  const chosen = event.legal_moves.indexOf(event.selected_move);
  return {
    classical_context: contextualProbabilities(event, snapshot.classical, snapshot.counts)[chosen],
    quantum_context: contextualProbabilities(event, snapshot.amplitude ?? snapshot.quantum, snapshot.counts)[chosen],
    // Zero fitted parameters, so it needs nothing from the snapshot and cannot
    // have been tuned on the session it is scoring.
    heuristic_baseline: heuristicProbabilities(event)[chosen],
  };
}
