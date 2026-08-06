/**
 * markets.js — Layer 2 (economic field) + Layer 3 (speculation) of the
 * quantum extension. See lib/quantum.js for the underlying math and
 * lib/agents.js for Layer 1 (nation posture).
 *
 * LAYER 2 — ECONOMIC FIELD
 * Four instruments as one 4-qubit entangled register, not four
 * independent scalars — generic slots [primary, currencyA, currencyB,
 * global], read out and displayed as scenario.aiAgents.marketInstruments
 * describes them. The correlation itself, and WHICH real-world
 * instruments fill those four slots, is genuinely bespoke content per
 * scenario (see propagateGeopolitics* below) — the Middle East's
 * oil/rial/riyal/gas correlation logic doesn't conceptually transplant
 * to Taiwan Strait's semiconductor/TWD/CNY/shipping field (a Saudi-style
 * "third party profits from the crisis" story doesn't fit China, which
 * takes real economic damage from its own escalation) — so each
 * scenario gets its own propagation function, dispatched by
 * scenario.meta.id, rather than a forced shared schema. Labels/symbols/
 * emoji themselves DO come from one place — scenario.aiAgents.
 * marketInstruments — so there's no duplicated label data to drift.
 *
 * That's encoded as a GHZ-like state — the four instruments' "shock"
 * branch (index0 of each) and "calm" branch (index1) move together as
 * two dominant joint branches, not four separate probabilities that
 * happen to correlate.
 *
 * The political layer (Layer 1) propagates INTO this one each cycle as
 * unitary rotations; it does not propagate back (one-directional, for
 * now — see quantum_extension memory for what Layer 2 -> Layer 1
 * feedback would look like).
 *
 * LAYER 3 — SPECULATION
 * Once the economic field's DIRECTION collapses (shock vs calm — the
 * fundamental), a roster of synthetic trader archetypes reacts to it.
 * Their reactions are combined as complex amplitudes (interfere(), not
 * averaged) to get the price move's magnitude — this is where fat
 * tails come from: when traders' framings interfere destructively
 * (their phases cancel), the move should be small and orderly; when
 * they interfere constructively in an unusual pattern, the move can be
 * disproportionately large relative to any single trader's conviction.
 * That's a real, falsifiable prediction, not decoration: it says price
 * volatility should track interference structure, not headline size.
 * This layer is scenario-agnostic — traders react to whatever
 * fundamental collapsed, regardless of what it represents.
 */

import {
  c, cAdd, cFromPolar, cPhase,
  ghzState, applyLocalRotationN, marginalProbability, measureQubit, interfere,
} from "./quantum.js";

const N_INSTRUMENTS = 4; // [PRIMARY, CURRENCY_A, CURRENCY_B, GLOBAL]
const PRIMARY = 0, CURRENCY_A = 1, CURRENCY_B = 2, GLOBAL = 3;

const clampUnit = (p) => Math.min(1, Math.max(0, p));

// Deterministic phase from an arbitrary string — same trick as agents.js's
// actionPhase(), reused here so trader framing/timing is stable across
// re-renders but varies across cycles and archetypes.
function hashPhase(key = "") {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000 * 2 * Math.PI;
}

function labelsFor(scenario) {
  return Object.fromEntries(
    scenario.aiAgents.marketInstruments.map((inst, i) => [i, [inst.shockLabel, inst.calmLabel]])
  );
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────

export function initMarketBeliefs() {
  // beta = PI/4: start maximally entangled / undecided between the four
  // instruments' shock and calm branches. Same starting structure for
  // every scenario — only the propagation rules and labels differ.
  return { instruments: ghzState(N_INSTRUMENTS, Math.PI / 4) };
}

function instrumentReadout(joint, idx, labels) {
  const [p0, p1] = marginalProbability(joint, N_INSTRUMENTS, idx);
  return { [labels[idx][0]]: p0, [labels[idx][1]]: p1 };
}

export function marketReadout(marketState, scenario) {
  const { instruments } = marketState;
  const labels = labelsFor(scenario);
  return {
    primary:   instrumentReadout(instruments, PRIMARY,    labels),
    currencyA: instrumentReadout(instruments, CURRENCY_A, labels),
    currencyB: instrumentReadout(instruments, CURRENCY_B, labels),
    global:    instrumentReadout(instruments, GLOBAL,     labels),
  };
}

// ─────────────────────────────────────────────────────────────
// LAYER 1 -> LAYER 2 PROPAGATION (unitary rotations, per cycle)
// One function per scenario — see file header for why this isn't
// forced into a shared schema.
// ─────────────────────────────────────────────────────────────

/**
 * Middle East: OIL(primary) / RIAL(currencyA) / RIYAL(currencyB) / GAS(global).
 * PRIMARY pushed toward SPIKING by Hormuz threats/closure, a hardline Iran
 * collapse, or Saudi cutting production. Each reason rotates the qubit
 * separately (own phase) rather than being pre-summed into one number —
 * that's what lets these reasons interfere across cycles instead of just
 * adding.
 */
function propagateMiddleEast(instruments, geoEvent, decisions, cycle) {
  let joint = instruments;
  const iranD  = decisions.iran?.decision;
  const saudiD = decisions.saudi_arabia?.decision;

  // PRIMARY (oil)
  if (iranD?.hormuzStatus === "CLOSED" || iranD?.hormuzStatus === "THREATENED") {
    const theta = iranD.hormuzStatus === "CLOSED" ? -Math.PI / 5 : -Math.PI / 10;
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, PRIMARY, theta, hashPhase(`hormuz:${cycle}`));
  }
  if (geoEvent?.iran === "hardline") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, PRIMARY, -Math.PI / 14, hashPhase(`iran-hardline:${cycle}`));
  }
  if (saudiD?.oilProductionStance === "CUTTING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, PRIMARY, -Math.PI / 8, hashPhase(`opec-cut:${cycle}`));
  } else if (saudiD?.oilProductionStance === "INCREASING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, PRIMARY, Math.PI / 8, hashPhase(`opec-increase:${cycle}`));
  }

  // GLOBAL (US retail gas): echoes PRIMARY's drivers, damped — roughly half
  // the rotation strength (partial pass-through, refining/distribution
  // lag) — and with its own phase so it doesn't move in lockstep every cycle.
  if (iranD?.hormuzStatus === "CLOSED" || iranD?.hormuzStatus === "THREATENED") {
    const theta = iranD.hormuzStatus === "CLOSED" ? -Math.PI / 8 : -Math.PI / 16;
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, GLOBAL, theta, hashPhase(`hormuz-global:${cycle}`));
  }
  if (geoEvent?.iran === "hardline") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, GLOBAL, -Math.PI / 20, hashPhase(`iran-hardline-global:${cycle}`));
  }
  if (saudiD?.oilProductionStance === "CUTTING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, GLOBAL, -Math.PI / 12, hashPhase(`opec-cut-global:${cycle}`));
  } else if (saudiD?.oilProductionStance === "INCREASING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, GLOBAL, Math.PI / 12, hashPhase(`opec-increase-global:${cycle}`));
  }

  // CURRENCY_A (rial): pushed toward WEAKENING by falling deal integrity or
  // a hardline Iran collapse; toward RESILIENT by rising deal integrity.
  const dealDelta = iranD?.metricDeltas?.dealIntegrity ?? 0;
  if (dealDelta !== 0) {
    const theta = clampUnit(Math.abs(dealDelta) / 20) * (Math.PI / 6) * (dealDelta < 0 ? -1 : 1);
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, CURRENCY_A, theta, hashPhase(`deal:${cycle}`));
  }
  if (geoEvent?.iran === "hardline") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, CURRENCY_A, -Math.PI / 12, hashPhase(`iran-hardline-currencyA:${cycle}`));
  }

  // CURRENCY_B (riyal): pushed toward ROBUST (the shock/windfall branch —
  // Saudi is the oil exporter who benefits) by a cautious Saudi collapse or
  // falling reform pressure; toward STRAINED by rising trade/normalization.
  const reformDelta = saudiD?.metricDeltas?.reformPressure ?? 0;
  if (geoEvent?.saudi_arabia === "cautious") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, CURRENCY_B, Math.PI / 10, hashPhase(`saudi-cautious:${cycle}`));
  }
  if (reformDelta !== 0) {
    const theta = clampUnit(Math.abs(reformDelta) / 15) * (Math.PI / 8) * (reformDelta < 0 ? 1 : -1);
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, CURRENCY_B, theta, hashPhase(`reform:${cycle}`));
  }

  return joint;
}

/**
 * Taiwan Strait: SEMI(primary) / TWD(currencyA) / CNY(currencyB) /
 * SHIP(global). PRIMARY pushed toward DISRUPTED by Chinese blockade/
 * invasion posture and by Japan tightening chip export controls (a real
 * lever — Japan supplies critical lithography/materials to TSMC).
 * CURRENCY_B (CNY) doesn't play RIYAL's "windfall beneficiary" role —
 * China isn't a windfall beneficiary of a Taiwan crisis, it takes real
 * economic damage from its own escalation (capital flight, decoupling,
 * export controls) — so CNY tracks China's own hardline collapse and
 * Japan's export-control pressure, both toward STRAINED.
 */
function propagateTaiwanStrait(instruments, geoEvent, decisions, cycle) {
  let joint = instruments;
  const chinaD = decisions.china?.decision;
  const japanD = decisions.japan?.decision;

  // PRIMARY (semiconductors)
  if (chinaD?.blockadeStatus === "BLOCKADE" || chinaD?.blockadeStatus === "GRAY_ZONE") {
    const theta = chinaD.blockadeStatus === "BLOCKADE" ? -Math.PI / 5 : -Math.PI / 10;
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, PRIMARY, theta, hashPhase(`blockade:${cycle}`));
  }
  if (geoEvent?.china === "hardline") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, PRIMARY, -Math.PI / 14, hashPhase(`china-hardline:${cycle}`));
  }
  if (japanD?.chipExportControlStance === "TIGHTENING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, PRIMARY, -Math.PI / 8, hashPhase(`chip-tighten:${cycle}`));
  } else if (japanD?.chipExportControlStance === "LOOSENING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, PRIMARY, Math.PI / 8, hashPhase(`chip-loosen:${cycle}`));
  }

  // GLOBAL (shipping/insurance): echoes PRIMARY's drivers, damped — same
  // partial-pass-through logic as the Middle East's US gas instrument.
  if (chinaD?.blockadeStatus === "BLOCKADE" || chinaD?.blockadeStatus === "GRAY_ZONE") {
    const theta = chinaD.blockadeStatus === "BLOCKADE" ? -Math.PI / 8 : -Math.PI / 16;
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, GLOBAL, theta, hashPhase(`blockade-global:${cycle}`));
  }
  if (geoEvent?.china === "hardline") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, GLOBAL, -Math.PI / 20, hashPhase(`china-hardline-global:${cycle}`));
  }
  if (japanD?.chipExportControlStance === "TIGHTENING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, GLOBAL, -Math.PI / 12, hashPhase(`chip-tighten-global:${cycle}`));
  } else if (japanD?.chipExportControlStance === "LOOSENING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, GLOBAL, Math.PI / 12, hashPhase(`chip-loosen-global:${cycle}`));
  }

  // CURRENCY_A (TWD): pushed toward WEAKENING by falling status-quo
  // integrity or a hardline China collapse — same logic as the rial.
  const dealDelta = chinaD?.metricDeltas?.dealIntegrity ?? 0;
  if (dealDelta !== 0) {
    const theta = clampUnit(Math.abs(dealDelta) / 20) * (Math.PI / 6) * (dealDelta < 0 ? -1 : 1);
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, CURRENCY_A, theta, hashPhase(`deal:${cycle}`));
  }
  if (geoEvent?.china === "hardline") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, CURRENCY_A, -Math.PI / 12, hashPhase(`china-hardline-currencyA:${cycle}`));
  }

  // CURRENCY_B (CNY): pushed toward STRAINED (China's own economic
  // exposure, NOT a windfall) by a hardline China collapse or Japan
  // tightening chip export controls (decoupling pressure on China's own
  // semiconductor ambitions).
  if (geoEvent?.china === "hardline") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, CURRENCY_B, -Math.PI / 10, hashPhase(`china-hardline-cny:${cycle}`));
  }
  if (japanD?.chipExportControlStance === "TIGHTENING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, CURRENCY_B, -Math.PI / 8, hashPhase(`chip-tighten-cny:${cycle}`));
  } else if (japanD?.chipExportControlStance === "LOOSENING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, CURRENCY_B, Math.PI / 8, hashPhase(`chip-loosen-cny:${cycle}`));
  }

  return joint;
}

const PROPAGATORS = {
  "middle-east-2026": propagateMiddleEast,
  "taiwan-strait-2026": propagateTaiwanStrait,
};

// Derived qualitative label, not a separate qubit — a single computed note
// alongside the four instruments' own outcomes. Middle East: oil is USD-
// denominated, so a pump-price surge pairs with a softer dollar in this
// model. Taiwan Strait: a shipping-insurance surge pairs with vessels
// rerouting away from the strait entirely (added distance/cost, not just
// higher premiums). Both are the same shape — a derived note keyed off the
// GLOBAL instrument's shock/calm outcome — so the frontend can render
// either generically via scenario.aiAgents without a per-scenario branch.
const DERIVED_NOTES = {
  "middle-east-2026":   { label: "Dollar Direction", shockValue: "SOFTENING", calmValue: "FIRMING" },
  "taiwan-strait-2026": { label: "Trade Routing",     shockValue: "REROUTING", calmValue: "NORMAL" },
};

// ─────────────────────────────────────────────────────────────
// LAYER 3 — SPECULATION (interference-based price resolution)
// Scenario-agnostic: traders react to whatever fundamental collapsed.
// ─────────────────────────────────────────────────────────────

const TRADER_ARCHETYPES = [
  { id: "momentum",       conviction: 0.75, follows: true  }, // trend-follows the resolved fundamental
  { id: "contrarian",     conviction: 0.45, follows: false }, // fades it, expecting mean reversion
  { id: "fundamentalist", conviction: 0.60, follows: true  },
  { id: "panic_seller",   conviction: 0.85, follows: true  }, // overreacts in the direction of shock
  { id: "safe_haven",     conviction: 0.35, follows: false },
  { id: "algo_flash",     conviction: 0.55, follows: true  },
];

// One trader's contribution as a complex "path": their conviction is the
// amplitude magnitude; their phase encodes whether they agree with the
// resolved shock/calm direction (phase 0) or fade it (phase PI), plus a
// per-cycle idiosyncratic jitter (their own timing/framing) so repeated
// identical fundamentals don't always interfere the same way.
function buildTraderPath(trader, shockDirection, instrumentKey, cycle) {
  const agrees = trader.follows ? shockDirection > 0 : shockDirection < 0;
  const basePhase = agrees ? 0 : Math.PI;
  const jitter = (hashPhase(`${trader.id}:${instrumentKey}:${cycle}`) - Math.PI) * 0.18; // small, bounded framing noise
  return { magnitude: trader.conviction, phase: basePhase + jitter };
}

function gaussianRandom(rng) {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function cauchyRandom(rng) {
  const x = Math.tan(Math.PI * (rng() - 0.5));
  return Math.max(-8, Math.min(8, x)); // bounded so a rare near-pole draw can't produce a nonsense outlier
}

/**
 * Resolve one instrument's price move: the FUNDAMENTAL direction (shock
 * vs calm) already collapsed via Born-rule measurement of the economic
 * field; this determines the move's MAGNITUDE and volatility character
 * from how the synthetic trader roster's reactions interfere.
 */
function resolvePriceMove(shockDirection, instrumentKey, cycle, baseVolatility, rng) {
  const paths = TRADER_ARCHETYPES.map((t) => buildTraderPath(t, shockDirection, instrumentKey, cycle));

  const total = paths.reduce((sum, p) => cAdd(sum, cFromPolar(p.magnitude, p.phase)), c(0, 0));
  const interferenceWeight = interfere(paths); // |sum of amplitudes|^2
  const classicalWeight = paths.reduce((s, p) => s + p.magnitude * p.magnitude, 0); // naive additive benchmark
  const anomalyGap = Math.abs(interferenceWeight - classicalWeight);

  // Net phase of the combined signal — near 0 means the roster net-agrees
  // with the fundamental, near PI means the roster net-fades it (a
  // "sell the news" configuration), independent of the fundamental's own
  // direction, which is exactly the kind of thing classical additive
  // aggregation of independent opinions can't produce.
  const netPhase = cPhase(total);
  const rosterDirection = Math.cos(netPhase) >= 0 ? 1 : -1;

  const tailWeight = clampUnit(anomalyGap / paths.length);
  const normalComponent = gaussianRandom(rng) * baseVolatility;
  const heavyComponent = cauchyRandom(rng) * baseVolatility * 1.8;
  const magnitude = Math.abs((1 - tailWeight) * normalComponent + tailWeight * heavyComponent);

  return {
    direction: rosterDirection,
    magnitude: Math.round(magnitude * 10) / 10,
    interferenceWeight: Math.round(interferenceWeight * 100) / 100,
    classicalWeight: Math.round(classicalWeight * 100) / 100,
    tailWeight: Math.round(tailWeight * 100) / 100,
  };
}

// ─────────────────────────────────────────────────────────────
// EVOLVE + COLLAPSE (runs once per commit, alongside Layer 1)
// ─────────────────────────────────────────────────────────────

/**
 * @param scenario      the scenario config (for aiAgents.marketInstruments labels + meta.id dispatch)
 * @param marketState   { instruments } from initMarketBeliefs() or a prior cycle
 * @param geoEvent      the Layer-1 collapse event (evolveAndCollapseQuantumState's `event`)
 * @param decisions     raw per-nation Claude decisions this cycle
 * @param cycle         current cycle number (feeds trader jitter determinism)
 * @param rng           injectable RNG for testability
 */
export function evolveAndCollapseMarkets(scenario, marketState, geoEvent, decisions, cycle, rng = Math.random) {
  const scenarioId = scenario.meta.id;
  const propagate = PROPAGATORS[scenarioId];
  if (!propagate) throw new Error(`evolveAndCollapseMarkets: unsupported scenario "${scenarioId}"`);

  const labels = labelsFor(scenario);
  const rotated = propagate(marketState.instruments, geoEvent, decisions, cycle);

  const preCollapse = marketReadout({ instruments: rotated }, scenario);

  const primaryM   = measureQubit(rotated, 4, PRIMARY, rng);
  const currencyAM = measureQubit(primaryM.reducedJoint, 3, 0, rng);
  const currencyBM = measureQubit(currencyAM.reducedJoint, 2, 0, rng);
  const globalM    = measureQubit(currencyBM.reducedJoint, 1, 0, rng);

  const outcomes = {
    primary:   labels[PRIMARY][primaryM.outcomeIndex],
    currencyA: labels[CURRENCY_A][currencyAM.outcomeIndex],
    currencyB: labels[CURRENCY_B][currencyBM.outcomeIndex],
    global:    labels[GLOBAL][globalM.outcomeIndex],
  };

  // shock direction per instrument: +1 = the "shock branch" of the GHZ
  // correlation (index0 in this scenario's labels), -1 = the calm branch.
  const primaryShock   = primaryM.outcomeIndex === 0 ? 1 : -1;
  const currencyAShock = currencyAM.outcomeIndex === 0 ? 1 : -1;
  const currencyBShock = currencyBM.outcomeIndex === 0 ? 1 : -1;
  const globalShock    = globalM.outcomeIndex === 0 ? 1 : -1;

  const primaryMove   = resolvePriceMove(primaryShock, "primary", cycle, 4, rng);
  const currencyAMove = resolvePriceMove(currencyAShock, "currencyA", cycle, 3, rng);
  const currencyBMove = resolvePriceMove(currencyBShock, "currencyB", cycle, 2.5, rng);
  const globalMove    = resolvePriceMove(globalShock, "global", cycle, 2.2, rng); // damped vs. primary's own spot-price volatility

  // Rebuild a fresh, un-entangled one-hot basis state from the four
  // measured outcomes for persistence — same approach as Layer 1.
  const flatIndex = primaryM.outcomeIndex * 8 + currencyAM.outcomeIndex * 4 + currencyBM.outcomeIndex * 2 + globalM.outcomeIndex;
  const collapsed = new Array(16).fill(c(0, 0));
  collapsed[flatIndex] = c(1, 0);

  const derivedNote = DERIVED_NOTES[scenarioId];

  return {
    newMarketState: { instruments: collapsed },
    event: {
      outcomes,
      preCollapse,
      primaryDelta:   primaryShock > 0 ? primaryMove.magnitude : -primaryMove.magnitude * 0.4,
      currencyADelta: currencyAShock > 0 ? -currencyAMove.magnitude : currencyAMove.magnitude * 0.3,
      currencyBDelta: currencyBShock > 0 ? currencyBMove.magnitude * 0.5 : -currencyBMove.magnitude * 0.6,
      // Damped pass-through: the global instrument moves less than the
      // primary one on the way up (margins/frictions absorb some shock)
      // and drifts down slowly rather than snapping back on the calm branch.
      globalDelta: globalShock > 0 ? globalMove.magnitude * 0.7 : -globalMove.magnitude * 0.3,
      derivedNote: derivedNote
        ? { label: derivedNote.label, value: globalShock > 0 ? derivedNote.shockValue : derivedNote.calmValue }
        : null,
      speculation: { primary: primaryMove, currencyA: currencyAMove, currencyB: currencyBMove, global: globalMove },
    },
  };
}
