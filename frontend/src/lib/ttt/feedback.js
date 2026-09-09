import { fitContextualModels, predictContextual } from "./contextual";

const TAUS = [0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 4, 10];
const KAPPAS = [0, 0.1, 0.25, 0.5, 0.75, 1];
const PHASES = [-Math.PI, -Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2, Math.PI];

function validEvents(events) {
  return events.filter((event) =>
    Array.isArray(event.legal_moves)
    && event.legal_moves.includes(event.selected_move)
    && event.minimax_action_values
  );
}

function summarize(name, probabilities, parameters = {}) {
  const safe = probabilities.map((value) => Math.max(value, 1e-12));
  return {
    name,
    meanLogLoss: safe.length ? -safe.reduce((sum, value) => sum + Math.log(value), 0) / safe.length : null,
    geometricProbability: safe.length ? Math.exp(safe.reduce((sum, value) => sum + Math.log(value), 0) / safe.length) : null,
    parameters,
  };
}

function softmaxLikelihood(events, tau) {
  return events.map((event) => {
    const logits = event.legal_moves.map((move) => Number(event.minimax_action_values[move]) / tau);
    const peak = Math.max(...logits);
    const weights = logits.map((value) => Math.exp(value - peak));
    return weights[event.legal_moves.indexOf(event.selected_move)] / weights.reduce((a, b) => a + b, 0);
  });
}

function amplitudeLikelihood(events, kappa, phase) {
  const counts = learnedCounts(events);
  return events.map((event) => {
    const mass = event.legal_moves.reduce((sum, move) => sum + counts[move], 0);
    const weights = event.legal_moves.map((move) => {
      const base = Math.sqrt(counts[move] / mass);
      const angle = phase * (move - 4) / 4;
      const reason = kappa * (Number(event.minimax_action_values[move]) + 1) / 2;
      const real = base * Math.cos(angle) + reason;
      const imaginary = base * Math.sin(angle);
      return real * real + imaginary * imaginary;
    });
    const selectedIndex = event.legal_moves.indexOf(event.selected_move);
    const probability = weights[selectedIndex] / weights.reduce((a, b) => a + b, 0);
    return probability;
  });
}

function learnedCounts(events) {
  const counts = Array(9).fill(1);
  for (const event of events) counts[event.selected_move] += 1;
  return counts;
}

function amplitudeProbability(event, counts, kappa, phase) {
  const mass = event.legal_moves.reduce((sum, move) => sum + counts[move], 0);
  const weights = event.legal_moves.map((move) => {
    const base = Math.sqrt(counts[move] / mass);
    const angle = phase * (move - 4) / 4;
    const reason = kappa * (Number(event.minimax_action_values[move]) + 1) / 2;
    return (base * Math.cos(angle) + reason) ** 2 + (base * Math.sin(angle)) ** 2;
  });
  return weights[event.legal_moves.indexOf(event.selected_move)] / weights.reduce((a, b) => a + b, 0);
}

function bestGrid(candidates, evaluate) {
  return candidates
    .map((parameters) => ({ parameters, probabilities: evaluate(parameters) }))
    .map((entry) => ({ ...entry, score: summarize("", entry.probabilities).meanLogLoss }))
    .sort((a, b) => a.score - b.score)[0];
}

export function analyzeFeedback(rawEvents) {
  const events = validEvents(rawEvents);
  const uniform = summarize("Random guessing", events.map((event) => 1 / event.legal_moves.length));
  if (!events.length) return { decisions: 0, models: [uniform], bestModel: null, meanResponseMs: null };

  const classical = bestGrid(TAUS.map((tau) => ({ tau })), ({ tau }) => softmaxLikelihood(events, tau));
  const amplitude = bestGrid(
    KAPPAS.flatMap((kappa) => PHASES.map((phase) => ({ kappa, phase }))),
    ({ kappa, phase }) => amplitudeLikelihood(events, kappa, phase),
  );
  const models = [
    uniform,
    summarize("Legacy classical · value only", classical.probabilities, classical.parameters),
    summarize("Legacy amplitude · value plus habits", amplitude.probabilities, amplitude.parameters),
  ];
  return {
    decisions: events.length,
    models,
    bestModel: null,
    meanResponseMs: events.reduce((sum, event) => sum + (Number(event.response_ms) || 0), 0) / events.length,
  };
}

export function fitFrozenModels(rawEvents) {
  const events = validEvents(rawEvents);
  if (!events.length) return null;
  const classical = bestGrid(TAUS.map((tau) => ({ tau })), ({ tau }) => softmaxLikelihood(events, tau));
  const amplitude = bestGrid(
    KAPPAS.flatMap((kappa) => PHASES.map((phase) => ({ kappa, phase }))),
    ({ kappa, phase }) => amplitudeLikelihood(events, kappa, phase),
  );
  return {
    schema: "ttt-frozen-models/v4",
    training_decisions: events.length,
    classical: classical.parameters,
    amplitude: { ...amplitude.parameters, counts: learnedCounts(events) },
    contextual: fitContextualModels(events),
  };
}

export function predictFrozen(event, snapshot) {
  if (!snapshot || !validEvents([event]).length) return null;
  const baseline = {
    random_guessing: 1 / event.legal_moves.length,
    classical_strategy: softmaxLikelihood([event], snapshot.classical.tau)[0],
    quantum_style: amplitudeProbability(
      event, snapshot.amplitude.counts, snapshot.amplitude.kappa, snapshot.amplitude.phase,
    ),
  };
  try {
    return {
      ...baseline,
      ...(predictContextual(event, snapshot.contextual) || {}),
      contextual_version: snapshot.contextual?.schema,
    };
  } catch {
    return baseline;
  }
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function analyzeValidationSessions(sessions) {
  const rows = sessions.map((session) => {
    const decisions = (session.decisions || []).filter((decision) => decision.modelPredictions);
    if (!decisions.length) return null;
    const error = (key) => mean(decisions.map((decision) => -Math.log(Math.max(decision.modelPredictions[key], 1e-12))));
    const contextual = decisions.every((decision) => Number.isFinite(decision.modelPredictions.classical_context) && Number.isFinite(decision.modelPredictions.quantum_context));
    const hasEnvelope = contextual && decisions.every((decision) => Number.isFinite(decision.modelPredictions.classical_envelope));
    const contextOnlyV4 = contextual && decisions.every((decision) => decision.modelPredictions.contextual_version === "ttt-context-models/v4-context-only");
    const classical = error(contextual ? "classical_context" : "classical_strategy");
    const quantum = error(contextual ? "quantum_context" : "quantum_style");
    const envelope = null;
    return {
      sessionId: session.session_id,
      moves: decisions.length,
      classical,
      quantum,
      envelope,
      difference: quantum - classical,
      envelopeGap: null,
      version: contextOnlyV4 ? "v4 context only" : hasEnvelope ? "v3 envelope quarantined" : contextual ? "v2 context diagnostic" : "v1 baseline",
    };
  }).filter(Boolean);
  if (!rows.length) return { rows: [], groups: [], classical: null, quantum: null, difference: null, interval: null, version: null };

  function summarizeRows(groupRows, version) {
    const totalMoves = groupRows.reduce((sum, row) => sum + row.moves, 0);
    const weighted = (key) => groupRows.reduce((sum, row) => sum + row[key] * row.moves, 0) / totalMoves;
    function bootstrapInterval(key, initialSeed) {
      if (groupRows.length < 8 || !groupRows.every((row) => Number.isFinite(row[key]))) return null;
      let seed = initialSeed;
      const draws = [];
      for (let iteration = 0; iteration < 5000; iteration += 1) {
        const sample = [];
        for (let index = 0; index < groupRows.length; index += 1) {
          seed = (1664525 * seed + 1013904223) >>> 0;
          sample.push(groupRows[Math.floor(seed / 2 ** 32 * groupRows.length)]);
        }
        const sampleMoves = sample.reduce((sum, row) => sum + row.moves, 0);
        draws.push(sample.reduce((sum, row) => sum + row[key] * row.moves, 0) / sampleMoves);
      }
      draws.sort((a, b) => a - b);
      return [draws[Math.floor(draws.length * 0.025)], draws[Math.floor(draws.length * 0.975)]];
    }
    const hasEnvelope = groupRows.every((row) => row.envelope !== null);
    return {
      version,
      rows: groupRows,
      classical: weighted("classical"),
      quantum: weighted("quantum"),
      envelope: hasEnvelope ? weighted("envelope") : null,
      difference: weighted("difference"),
      envelopeGap: hasEnvelope ? weighted("envelopeGap") : null,
      interval: bootstrapInterval("difference", 0x5eed1234),
      envelopeInterval: bootstrapInterval("envelopeGap", 0x71ac1ca1),
    };
  }

  const precedence = ["v1 baseline", "v2 context diagnostic", "v3 envelope quarantined", "v4 context only"];
  const versions = [...new Set(rows.map((row) => row.version))].sort((a, b) => precedence.indexOf(a) - precedence.indexOf(b));
  const groups = versions.map((version) => summarizeRows(rows.filter((row) => row.version === version), version));
  return { ...groups.at(-1), rows, groups };
}
