/**
 * markets.js — Layer 2 (economic field) + Layer 3 (speculation) of the
 * quantum extension. See lib/quantum.js for the underlying math and
 * lib/agents.js for Layer 1 (nation posture).
 *
 * LAYER 2 — ECONOMIC FIELD
 * Four instruments — oil, the Iranian rial, the Saudi riyal's fiscal
 * position, and the US retail gas price — as one 4-qubit entangled
 * register, not four independent scalars. The correlation is
 * structural, not incidental: an oil shock stresses Iran's currency
 * (sanctions-evasion trade breaks down, war risk) while it fills Saudi
 * coffers (they're the exporter); a calm oil market does the reverse
 * (Iran's currency isn't oil-exposed the same way; Saudi loses the
 * windfall it needs for Vision 2030 without added political will to cut
 * spending). The US gas qubit rides the same shock/calm branches —
 * pump prices are a damped, lagged echo of the crude spot price
 * (partial pass-through through refining/distribution) — encoded with
 * its own rotation triggers and phase so it doesn't move in lockstep
 * with crude every cycle. That's encoded as a GHZ-like state — the two
 * dominant joint branches are (SPIKING, WEAKENING, ROBUST, SURGING)
 * and (STABLE, RESILIENT, STRAINED, CALM) — not four separate
 * probabilities that happen to move together. The US gas qubit's
 * collapse outcome also carries a derived, non-qubit USD-direction note
 * (oil is USD-denominated: a pump-price surge pairs with a softer
 * dollar in this model) — that's a computed label, not a fifth qubit;
 * modeling USD strength as its own entangled instrument was
 * deliberately left out of scope for now.
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
 */

import {
  c, cAdd, cFromPolar, cPhase,
  ghzState, applyLocalRotationN, marginalProbability, measureQubit, interfere,
} from "./quantum";

const N_INSTRUMENTS = 4; // [OIL, RIAL, RIYAL, USGAS]
const OIL = 0, RIAL = 1, RIYAL = 2, USGAS = 3;

// Basis labels per instrument, index0 = the "shock-aligned" branch of the GHZ state.
const LABELS = {
  [OIL]:   ["SPIKING", "STABLE"],
  [RIAL]:  ["WEAKENING", "RESILIENT"],
  [RIYAL]: ["ROBUST", "STRAINED"], // note: index0 ROBUST is the shock-branch outcome for Saudi (oil windfall)
  [USGAS]: ["SURGING", "CALM"],    // US retail pump price — shock branch mirrors OIL's SPIKING, damped
};

const clampUnit = (p) => Math.min(1, Math.max(0, p));

// Deterministic phase from an arbitrary string — same trick as agents.js's
// actionPhase(), reused here so trader framing/timing is stable across
// re-renders but varies across cycles and archetypes.
function hashPhase(key = "") {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000 * 2 * Math.PI;
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────

export function initMarketBeliefs() {
  // beta = PI/4: start maximally entangled / undecided between the
  // (shock, weakening, robust) and (calm, resilient, strained) branches.
  return { instruments: ghzState(N_INSTRUMENTS, Math.PI / 4) };
}

function instrumentReadout(joint, idx) {
  const [p0, p1] = marginalProbability(joint, N_INSTRUMENTS, idx);
  return { [LABELS[idx][0]]: p0, [LABELS[idx][1]]: p1 };
}

export function marketReadout(marketState) {
  const { instruments } = marketState;
  return {
    oil:   instrumentReadout(instruments, OIL),
    rial:  instrumentReadout(instruments, RIAL),
    riyal: instrumentReadout(instruments, RIYAL),
    usGas: instrumentReadout(instruments, USGAS),
  };
}

// ─────────────────────────────────────────────────────────────
// LAYER 1 -> LAYER 2 PROPAGATION (unitary rotations, per cycle)
// ─────────────────────────────────────────────────────────────

/**
 * Fold this cycle's geopolitical outcome + classical decisions into the
 * economic field as unitary rotations. `geoEvent` is the Layer-1
 * collapse event (from evolveAndCollapseQuantumState), decisions are
 * the raw per-nation Claude output.
 */
function propagateGeopoliticsToMarkets(instruments, geoEvent, decisions, cycle) {
  let joint = instruments;
  const iranD  = decisions.iran?.decision;
  const saudiD = decisions.saudi_arabia?.decision;

  // OIL: pushed toward SPIKING by Hormuz threats/closure, a hardline Iran
  // collapse, or Saudi cutting production. Each reason rotates the qubit
  // separately (own phase) rather than being pre-summed into one number —
  // that's what lets these reasons interfere across cycles instead of
  // just adding.
  if (iranD?.hormuzStatus === "CLOSED" || iranD?.hormuzStatus === "THREATENED") {
    const theta = iranD.hormuzStatus === "CLOSED" ? -Math.PI / 5 : -Math.PI / 10;
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, OIL, theta, hashPhase(`hormuz:${cycle}`));
  }
  if (geoEvent?.iran === "hardline") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, OIL, -Math.PI / 14, hashPhase(`iran-hardline:${cycle}`));
  }
  if (saudiD?.oilProductionStance === "CUTTING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, OIL, -Math.PI / 8, hashPhase(`opec-cut:${cycle}`));
  } else if (saudiD?.oilProductionStance === "INCREASING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, OIL, Math.PI / 8, hashPhase(`opec-increase:${cycle}`));
  }

  // US GAS: retail pump price echoes the same crude-oil drivers as OIL,
  // but damped — roughly half the rotation strength, reflecting partial
  // pass-through and refining/distribution lag — and with its own phase
  // (separate hashPhase key) so it doesn't move in lockstep with the
  // crude spot price every single cycle.
  if (iranD?.hormuzStatus === "CLOSED" || iranD?.hormuzStatus === "THREATENED") {
    const theta = iranD.hormuzStatus === "CLOSED" ? -Math.PI / 8 : -Math.PI / 16;
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, USGAS, theta, hashPhase(`hormuz-usgas:${cycle}`));
  }
  if (geoEvent?.iran === "hardline") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, USGAS, -Math.PI / 20, hashPhase(`iran-hardline-usgas:${cycle}`));
  }
  if (saudiD?.oilProductionStance === "CUTTING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, USGAS, -Math.PI / 12, hashPhase(`opec-cut-usgas:${cycle}`));
  } else if (saudiD?.oilProductionStance === "INCREASING") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, USGAS, Math.PI / 12, hashPhase(`opec-increase-usgas:${cycle}`));
  }

  // RIAL: pushed toward WEAKENING by falling deal integrity or a hardline
  // Iran collapse; toward RESILIENT by rising deal integrity.
  const dealDelta = iranD?.metricDeltas?.dealIntegrity ?? 0;
  if (dealDelta !== 0) {
    const theta = clampUnit(Math.abs(dealDelta) / 20) * (Math.PI / 6) * (dealDelta < 0 ? -1 : 1);
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, RIAL, theta, hashPhase(`deal:${cycle}`));
  }
  if (geoEvent?.iran === "hardline") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, RIAL, -Math.PI / 12, hashPhase(`iran-hardline-rial:${cycle}`));
  }

  // RIYAL: pushed toward STRAINED by a cautious Saudi collapse or falling
  // reform pressure; toward ROBUST by rising trade / advancing normalization.
  const reformDelta = saudiD?.metricDeltas?.reformPressure ?? 0;
  if (geoEvent?.saudi === "cautious") {
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, RIYAL, Math.PI / 10, hashPhase(`saudi-cautious:${cycle}`));
  }
  if (reformDelta !== 0) {
    const theta = clampUnit(Math.abs(reformDelta) / 15) * (Math.PI / 8) * (reformDelta < 0 ? 1 : -1);
    joint = applyLocalRotationN(joint, N_INSTRUMENTS, RIYAL, theta, hashPhase(`reform:${cycle}`));
  }

  return joint;
}

// ─────────────────────────────────────────────────────────────
// LAYER 3 — SPECULATION (interference-based price resolution)
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
 * @param marketState  { instruments } from initMarketBeliefs() or a prior cycle
 * @param geoEvent      the Layer-1 collapse event (evolveAndCollapseQuantumState's `event`)
 * @param decisions     raw per-nation Claude decisions this cycle
 * @param cycle         current cycle number (feeds trader jitter determinism)
 * @param rng           injectable RNG for testability
 */
export function evolveAndCollapseMarkets(marketState, geoEvent, decisions, cycle, rng = Math.random) {
  const rotated = propagateGeopoliticsToMarkets(marketState.instruments, geoEvent, decisions, cycle);

  const preCollapse = marketReadout({ instruments: rotated });

  const oilM   = measureQubit(rotated, 4, OIL, rng);
  const rialM  = measureQubit(oilM.reducedJoint, 3, 0, rng);
  const riyalM = measureQubit(rialM.reducedJoint, 2, 0, rng);
  const usGasM = measureQubit(riyalM.reducedJoint, 1, 0, rng);

  const outcomes = {
    oil:   LABELS[OIL][oilM.outcomeIndex],
    rial:  LABELS[RIAL][rialM.outcomeIndex],
    riyal: LABELS[RIYAL][riyalM.outcomeIndex],
    usGas: LABELS[USGAS][usGasM.outcomeIndex],
  };

  // shock direction per instrument: +1 = the "shock branch" of the GHZ
  // correlation (SPIKING / WEAKENING / ROBUST / SURGING), -1 = the calm branch.
  const oilShock   = oilM.outcomeIndex === 0 ? 1 : -1;
  const rialShock  = rialM.outcomeIndex === 0 ? 1 : -1;
  const riyalShock = riyalM.outcomeIndex === 0 ? 1 : -1; // ROBUST is index0, i.e. the shock branch for Saudi
  const usGasShock = usGasM.outcomeIndex === 0 ? 1 : -1;

  const oilMove   = resolvePriceMove(oilShock, "oil", cycle, 4, rng);
  const rialMove  = resolvePriceMove(rialShock, "rial", cycle, 3, rng);
  const riyalMove = resolvePriceMove(riyalShock, "riyal", cycle, 2.5, rng);
  const usGasMove = resolvePriceMove(usGasShock, "usgas", cycle, 2.2, rng); // damped vs. oil's own spot-price volatility

  // Rebuild a fresh, un-entangled one-hot basis state from the four
  // measured outcomes for persistence — same approach as Layer 1.
  const flatIndex = oilM.outcomeIndex * 8 + rialM.outcomeIndex * 4 + riyalM.outcomeIndex * 2 + usGasM.outcomeIndex;
  const collapsed = new Array(16).fill(c(0, 0));
  collapsed[flatIndex] = c(1, 0);

  return {
    newMarketState: { instruments: collapsed },
    event: {
      outcomes,
      preCollapse,
      oilPriceDelta:   oilShock > 0 ? oilMove.magnitude : -oilMove.magnitude * 0.4,
      rialIndexDelta:  rialShock > 0 ? -rialMove.magnitude : rialMove.magnitude * 0.3,
      riyalIndexDelta: riyalShock > 0 ? riyalMove.magnitude * 0.5 : -riyalMove.magnitude * 0.6,
      // Damped pass-through: pump prices move less than crude on the way up
      // (retailer margins, taxes absorb some shock) and drift down slowly
      // rather than snapping back on the calm branch.
      usGasIndexDelta: usGasShock > 0 ? usGasMove.magnitude * 0.7 : -usGasMove.magnitude * 0.3,
      // Derived qualitative note, not a separate qubit: oil is USD-
      // denominated, so a pump-price surge pairs with a softer dollar in
      // this model (and vice versa on the calm branch).
      usdDirection: usGasShock > 0 ? "SOFTENING" : "FIRMING",
      speculation: { oil: oilMove, rial: rialMove, riyal: riyalMove, usGas: usGasMove },
    },
  };
}
