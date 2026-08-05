/**
 * quantum.js — a small, real quantum-cognition engine.
 *
 * This is NOT a metaphor layer. Beliefs are represented as complex
 * probability amplitudes in a Hilbert space (qubits), updated with
 * unitary rotations, and read out with Born-rule measurement. That
 * buys three effects classical (Bayesian) probability cannot produce,
 * which is the actual point of using quantum cognition here
 * (Busemeyer & Bruza, "Quantum Models of Cognition and Decision"):
 *
 *   1. INTERFERENCE — two reasons pointing at the same conclusion can
 *      reinforce or cancel depending on relative phase, not just add.
 *   2. ORDER EFFECTS — applying influence A-then-B can land on a
 *      different belief state than B-then-A, because rotations don't
 *      commute. Classical updating is order-independent; this isn't.
 *   3. ENTANGLEMENT — two nations' postures can be correlated in a way
 *      that isn't reducible to either one's individual probabilities;
 *      measuring one changes the other's remaining distribution.
 *
 * A belief state collapses (Born rule) only at the moment a definite
 * outcome is needed — here, at blockchain commit. Between commits it
 * stays in superposition and keeps evolving.
 *
 * Everything below is generic linear algebra over 2- and 4-dimensional
 * complex vectors. Domain meaning (which basis state means what) lives
 * in agents.js, not here.
 */

// ─────────────────────────────────────────────────────────────
// COMPLEX ARITHMETIC
// ─────────────────────────────────────────────────────────────

export const c = (re, im = 0) => ({ re, im });
export const cAdd = (a, b) => c(a.re + b.re, a.im + b.im);
export const cMul = (a, b) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const cScale = (a, s) => c(a.re * s, a.im * s);
export const cConj = (a) => c(a.re, -a.im);
export const cAbs2 = (a) => a.re * a.re + a.im * a.im;
export const cAbs = (a) => Math.sqrt(cAbs2(a));
export const cPhase = (a) => Math.atan2(a.im, a.re);
export const cFromPolar = (r, theta) => c(r * Math.cos(theta), r * Math.sin(theta));

const ZERO = c(0, 0);

// ─────────────────────────────────────────────────────────────
// SINGLE QUBIT — one binary belief dimension
// e.g. Iran: [hardline, pragmatic]  |  Israel: [hawkish, dovish]
// ─────────────────────────────────────────────────────────────

export function basisQubit(index) {
  return index === 0 ? [c(1, 0), c(0, 0)] : [c(0, 0), c(1, 0)];
}

export function normalizeQubit([a, b]) {
  const norm = Math.sqrt(cAbs2(a) + cAbs2(b));
  if (norm === 0) return basisQubit(0);
  return [cScale(a, 1 / norm), cScale(b, 1 / norm)];
}

export function probabilities([a, b]) {
  return [cAbs2(a), cAbs2(b)];
}

/**
 * Quantum coherence — the off-diagonal term of the density matrix.
 * 0 means the state currently behaves like a classical mixture;
 * nonzero means superposition is actually doing work. Diagnostic only.
 */
export function coherence([a, b]) {
  return 2 * cAbs(cMul(a, cConj(b)));
}

/**
 * A single "influence" event (news, pressure, a framing effect) acting
 * on a belief qubit, as a generalized SU(2) rotation:
 *
 *   theta — strength of the push toward flipping the basis (0..PI/2)
 *   phi   — contextual "framing phase". Two influences with the same
 *           theta but different phi compose differently depending on
 *           order — this is what generates real order effects below.
 *
 * Unitary: preserves total probability exactly.
 */
export function rotate([a, b], theta, phi) {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const ePlus = cFromPolar(1, phi);
  const eMinus = cFromPolar(1, -phi);
  const newA = cAdd(cScale(a, cos), cScale(cMul(eMinus, b), -sin));
  const newB = cAdd(cScale(cMul(ePlus, a), sin), cScale(b, cos));
  return normalizeQubit([newA, newB]);
}

/** Apply a sequence of influences IN ORDER. Order matters — see orderEffect(). */
export function applySequence(qubit, influences) {
  return influences.reduce((q, { theta, phi }) => rotate(q, theta, phi), qubit);
}

/**
 * Directly measurable order effect: same two influences, both orders,
 * how far apart do the resulting probabilities land? gap > 0 is proof
 * the update is non-commutative — a signature classical Bayesian
 * updating cannot produce.
 *
 * Note: starting from a pure basis state (no prior superposition) this
 * particular rotation family lands on the same probabilities either
 * order — the gap only opens up once the qubit already carries some
 * superposition from earlier influences. That's not a special case to
 * work around, it's the realistic regime: a belief with no history has
 * nothing for order to act on; a belief shaped by prior cycles does.
 */
export function orderEffect(qubit, influenceA, influenceB) {
  const first = applySequence(qubit, [influenceA, influenceB]);
  const second = applySequence(qubit, [influenceB, influenceA]);
  return {
    firstThenSecond: probabilities(first),
    secondThenFirst: probabilities(second),
    gap: Math.abs(probabilities(first)[1] - probabilities(second)[1]),
  };
}

/**
 * Interference: combine alternative "paths" to the same outcome as
 * complex amplitudes, THEN square — rather than combining as
 * probabilities. paths: [{ magnitude: 0..1, phase: radians }].
 * Aligned phases reinforce (constructive), opposed phases cancel
 * (destructive). Classical probability, which can only add
 * nonnegative weights, cannot reproduce cancellation.
 */
export function interfere(paths) {
  const total = paths.reduce((sum, p) => cAdd(sum, cFromPolar(p.magnitude, p.phase)), ZERO);
  return cAbs2(total);
}

/** Born-rule projective measurement of a single qubit. */
export function collapseQubit(qubit, labels = ["0", "1"], rng = Math.random) {
  const [p0] = probabilities(qubit);
  const outcomeIndex = rng() < p0 ? 0 : 1;
  return {
    outcome: labels[outcomeIndex],
    outcomeIndex,
    probabilities: { [labels[0]]: probabilities(qubit)[0], [labels[1]]: probabilities(qubit)[1] },
    coherence: coherence(qubit),
    collapsedState: basisQubit(outcomeIndex),
  };
}

// ─────────────────────────────────────────────────────────────
// ENTANGLED PAIR — two correlated binary beliefs
// Joint 4-vector, basis order [A0B0, A0B1, A1B0, A1B1]
// e.g. Iran x Israel: [hardline&hawkish, hardline&dovish, pragmatic&hawkish, pragmatic&dovish]
// ─────────────────────────────────────────────────────────────

function normalizeJoint(v) {
  const norm = Math.sqrt(v.reduce((s, x) => s + cAbs2(x), 0));
  if (norm === 0) return v;
  return v.map((x) => cScale(x, 1 / norm));
}

/**
 * Bell-like correlated initial state:
 *   cos(alpha)|A0,B0> + sin(alpha)|A1,B1>
 * alpha=0        -> no correlation, subsystems independent (classical)
 * alpha=PI/4      -> maximal entanglement
 * Use this to encode a structural coupling like the security dilemma:
 * Iran hardline correlates with Israel hawkish, Iran pragmatic
 * correlates with Israel dovish, without either side being in a
 * definite state on its own.
 */
export function entangledPair(alpha = Math.PI / 4) {
  return normalizeJoint([cFromPolar(Math.cos(alpha), 0), ZERO, ZERO, cFromPolar(Math.sin(alpha), 0)]);
}

export function jointProbabilities(joint) {
  return joint.map(cAbs2);
}

export function marginalA(joint) {
  const p = jointProbabilities(joint);
  return [p[0] + p[1], p[2] + p[3]];
}

export function marginalB(joint) {
  const [p00, p01, p10, p11] = jointProbabilities(joint);
  return [p00 + p10, p01 + p11];
}

/**
 * Entanglement diagnostic: how much does knowing A's outcome change
 * B's distribution? 0 = independent, larger = more entangled.
 * (Simple TV-distance between B's marginal and B's outcome-0-conditional.)
 */
export function entanglementStrength(joint) {
  const [p00, p01] = jointProbabilities(joint);
  const pA0 = p00 + p01;
  if (pA0 === 0 || pA0 === 1) return 0;
  const bGivenA0 = [p00 / pA0, p01 / pA0];
  const bMarginal = marginalB(joint);
  return Math.abs(bGivenA0[0] - bMarginal[0]);
}

/** Apply a local rotation to subsystem A only: (R ⊗ I). */
export function applyLocalRotation(joint, subsystem, theta, phi) {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const ePlus = cFromPolar(1, phi);
  const eMinus = cFromPolar(1, -phi);
  const [q00, q01, q10, q11] = joint;

  if (subsystem === "A") {
    return normalizeJoint([
      cAdd(cScale(q00, cos), cScale(cMul(eMinus, q10), -sin)),
      cAdd(cScale(q01, cos), cScale(cMul(eMinus, q11), -sin)),
      cAdd(cScale(cMul(ePlus, q00), sin), cScale(q10, cos)),
      cAdd(cScale(cMul(ePlus, q01), sin), cScale(q11, cos)),
    ]);
  }
  // subsystem === "B": (I ⊗ R)
  return normalizeJoint([
    cAdd(cScale(q00, cos), cScale(cMul(eMinus, q01), -sin)),
    cAdd(cScale(cMul(ePlus, q00), sin), cScale(q01, cos)),
    cAdd(cScale(q10, cos), cScale(cMul(eMinus, q11), -sin)),
    cAdd(cScale(cMul(ePlus, q10), sin), cScale(q11, cos)),
  ]);
}

/** Reduced-state coherence for subsystem A (off-diagonal magnitude of Tr_B|psi><psi|). */
export function coherenceA(joint) {
  const [q00, q01, q10, q11] = joint;
  const offDiag = cAdd(cMul(q00, cConj(q10)), cMul(q01, cConj(q11)));
  return 2 * cAbs(offDiag);
}

/** Reduced-state coherence for subsystem B (off-diagonal magnitude of Tr_A|psi><psi|). */
export function coherenceB(joint) {
  const [q00, q01, q10, q11] = joint;
  const offDiag = cAdd(cMul(q00, cConj(q01)), cMul(q10, cConj(q11)));
  return 2 * cAbs(offDiag);
}

/**
 * Measure subsystem A. Projects the joint state onto the observed
 * outcome and renormalizes what's left — the operational content of
 * "entanglement": B's remaining amplitude is no longer independent of
 * A's outcome. Returns the collapsed joint state (B stays a qubit,
 * now conditioned, until it's measured too) plus B's conditional
 * probabilities for immediate use.
 */
export function measureA(joint, rng = Math.random) {
  const [pA0] = marginalA(joint);
  const outcomeIndex = rng() < pA0 ? 0 : 1;
  const [q00, q01, q10, q11] = joint;
  const rawKeep = outcomeIndex === 0 ? [q00, q01] : [q10, q11];
  const conditionedB = normalizeQubit(rawKeep);
  const newJoint =
    outcomeIndex === 0
      ? [conditionedB[0], conditionedB[1], ZERO, ZERO]
      : [ZERO, ZERO, conditionedB[0], conditionedB[1]];
  return {
    outcomeIndex,
    conditionedB, // subsystem B's qubit, now conditioned on A's outcome
    conditionedBProbabilities: probabilities(conditionedB),
    unconditionedBProbabilities: marginalB(joint),
    newJoint,
  };
}

// ─────────────────────────────────────────────────────────────
// N-QUBIT REGISTER (generic)
//
// The 2-qubit functions above are kept as-is (Iran/Israel already
// depend on them). Everything below generalizes the same ideas —
// local rotation, marginal probability, projective measurement — to a
// register of any size, basis index = bits b0 b1 ... b(n-1) with b0 as
// the MOST significant bit (qubit 0 first), matching the [A0B0, A0B1,
// A1B0, A1B1] convention already used above. Used by markets.js for
// the 3-instrument (oil / rial / riyal) entangled economic field.
// ─────────────────────────────────────────────────────────────

/** GHZ-like N-qubit correlated state: cos(beta)|00..0> + sin(beta)|11..1>. */
export function ghzState(nQubits, beta = Math.PI / 4) {
  const size = 2 ** nQubits;
  const v = new Array(size).fill(ZERO);
  v[0] = c(Math.cos(beta), 0);
  v[size - 1] = c(Math.sin(beta), 0);
  return v;
}

/** (R applied to qubit `qubitPos`) ⊗ I on the rest, for an N-qubit joint state. */
export function applyLocalRotationN(joint, nQubits, qubitPos, theta, phi) {
  const mask = 1 << (nQubits - 1 - qubitPos);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const ePlus = cFromPolar(1, phi);
  const eMinus = cFromPolar(1, -phi);
  const out = joint.slice();
  for (let idx = 0; idx < joint.length; idx++) {
    if ((idx & mask) !== 0) continue; // process each {0,1} pair once, from the 0 side
    const partner = idx | mask;
    const a = joint[idx];
    const b = joint[partner];
    out[idx] = cAdd(cScale(a, cos), cScale(cMul(eMinus, b), -sin));
    out[partner] = cAdd(cScale(cMul(ePlus, a), sin), cScale(b, cos));
  }
  return normalizeJoint(out);
}

/** Probability of qubit `qubitPos` reading 0 vs 1, marginalizing over every other qubit. */
export function marginalProbability(joint, nQubits, qubitPos) {
  const mask = 1 << (nQubits - 1 - qubitPos);
  const probs = jointProbabilities(joint);
  let p0 = 0;
  let p1 = 0;
  for (let idx = 0; idx < probs.length; idx++) {
    if ((idx & mask) === 0) p0 += probs[idx];
    else p1 += probs[idx];
  }
  return [p0, p1];
}

/**
 * Project-and-renormalize measurement of a single qubit out of an
 * N-qubit register (Born rule). Returns the sampled outcome and the
 * REDUCED joint state over the remaining N-1 qubits, in their original
 * relative order — call again on the result to measure the next qubit,
 * chaining exactly like measureA() -> collapseQubit() does for the pair.
 */
export function measureQubit(joint, nQubits, qubitPos, rng = Math.random) {
  const [p0] = marginalProbability(joint, nQubits, qubitPos);
  const outcomeIndex = rng() < p0 ? 0 : 1;
  const mask = 1 << (nQubits - 1 - qubitPos);
  const keep = [];
  for (let idx = 0; idx < joint.length; idx++) {
    const bit = (idx & mask) !== 0 ? 1 : 0;
    if (bit === outcomeIndex) keep.push(joint[idx]);
  }
  return { outcomeIndex, reducedJoint: normalizeJoint(keep) };
}
