/**
 * QUANTUM vs. CLASSICAL MODEL COMPARISON
 *
 * The falsifiable claim behind the quantum-cognition layer (see
 * GRANT_APPLICATION.md, "Quantum-modeled uncertainty" + quantum-extension
 * memory) is that the entangled joint state produces a genuine correlation
 * between two nations' collapsed postures that a classical model of the
 * SAME decision inputs cannot reproduce. This script tests that directly,
 * using the exact production rotation code from lib/quantum.js and
 * lib/agents.js — not a reimplementation.
 *
 * DESIGN (isolates entanglement specifically, not just "any correlation"):
 *   Every trial draws ONE shared sequence of synthetic per-cycle decision
 *   deltas (see "SYNTHETIC INPUT DATA" below) and feeds that IDENTICAL
 *   sequence into two arms:
 *
 *     QUANTUM ARM  — starts from entangledPair(alpha) (a Bell-like joint
 *                    state), applies each cycle's rotations via
 *                    applyLocalRotation(joint, "A"/"B", ...), measures with
 *                    measureA() + collapseQubit() (A's outcome conditions
 *                    B's, per production evolveAndCollapseQuantumState()).
 *
 *     CLASSICAL ARM — starts from a PRODUCT state: two independent qubits
 *                     with the SAME initial marginals as the quantum arm's
 *                     (so single-nation probabilities are identical by
 *                     construction), applies the SAME rotations to each
 *                     independently via rotate(), measures independently.
 *
 *   Since both arms see identical decision inputs and identical initial
 *   marginals, any joint-outcome correlation gap between them is
 *   attributable specifically to the entanglement structure, not to
 *   shared-cause correlation from correlated decisions (deltaA and deltaB
 *   are themselves drawn independently per cycle, so there's no shared-
 *   cause correlation to begin with — the quantum arm's correlation, if
 *   any, comes ONLY from the Bell state / entangled-escalation mechanism).
 *
 * METRIC: standard chi-square test of independence on each arm's 2x2
 * joint-outcome contingency table (df=1). A large statistic / small
 * p-value on the quantum arm plus a null result on the classical arm is
 * the concrete falsifiable signature this model predicts.
 *
 * SYNTHETIC INPUT DATA — IMPORTANT CAVEAT:
 * This first pass uses per-cycle decision deltas drawn uniformly from the
 * same bounds the production code clamps against (rotationTheta's maxAbs
 * args), NOT real logged Claude decisions. That's a deliberate, cheap
 * first step (no API key needed, runs in seconds) — it validates that the
 * MECHANISM produces the predicted statistical signature at all. It is
 * NOT yet evidence that real geopolitical decision-making shows this
 * pattern. The natural next step is swapping the synthetic sampler below
 * for real decision-delta sequences pulled from logged AIResultsStep
 * "Quantum Measurement Log" / "Agent Decision Log" runs once enough of
 * those exist — the trial loop and statistics below don't need to change,
 * only sampleCycleDeltas().
 *
 * Usage:
 *   node scripts/quantum-vs-classical-test.mjs [scenarioPath] [nTrials] [nCycles]
 *   node scripts/quantum-vs-classical-test.mjs ../scenarios/middle-east-2026.config.cjs 5000 3
 *
 * No blockchain, no Hardhat, no API key — pure Node, ESM, offline.
 */

import {
  entangledPair, applyLocalRotation, measureA, collapseQubit,
  marginalA, marginalB, entanglementStrength, probabilities, rotate,
} from "../frontend/src/lib/quantum.js";
import {
  nationsById, driverProbability, actionPhase, rotationTheta,
} from "../frontend/src/lib/agents.js";

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const scenarioPath = process.argv[2] || "../scenarios/middle-east-2026.config.cjs";
const N_TRIALS = parseInt(process.argv[3] || "5000", 10);
const N_CYCLES = parseInt(process.argv[4] || "3", 10);

const { default: scenario } = await import(scenarioPath);
const { entangled } = scenario.aiAgents;
const nations = nationsById(scenario);

// Same synthetic action vocabulary regardless of scenario — actionPhase()
// only cares about the string's hash, not its domain meaning, so this is
// scenario-agnostic by construction (matches how production code treats it).
const ACTION_IDS = ["ESCALATE", "DE_ESCALATE", "HOLD", "NEGOTIATE", "EXIT_DEAL", "SIGNAL"];

function sampleCycleDeltas(rng) {
  // Bounds match rotationTheta's maxAbs args in evolveAndCollapseQuantumState()
  // (15 for side A's driver, 10 for side B's) — see agents.js.
  const deltaA = (rng() * 2 - 1) * 15;
  const deltaB = (rng() * 2 - 1) * 10;
  const actionA = ACTION_IDS[Math.floor(rng() * ACTION_IDS.length)];
  const actionB = ACTION_IDS[Math.floor(rng() * ACTION_IDS.length)];
  return { deltaA, deltaB, actionA, actionB };
}

// ─────────────────────────────────────────────────────────────
// SHARED INITIAL STATE (identical starting marginals, both arms)
// ─────────────────────────────────────────────────────────────

const aProb = driverProbability(nations[entangled.aId], entangled.aDriverField, entangled.aDriverDirection);
const alpha = Math.acos(Math.sqrt(aProb));

function freshQuantumJoint() {
  return entangledPair(alpha); // Bell-like: cos(alpha)|00> + sin(alpha)|11>
}

function freshClassicalPair() {
  // Product state with the SAME marginal on each side as the quantum arm's
  // initial state (entangledPair(alpha) forces B's initial marginal to
  // equal A's, by construction — see initQuantumBeliefs()'s own comment).
  const qA = [{ re: Math.sqrt(aProb), im: 0 }, { re: Math.sqrt(1 - aProb), im: 0 }];
  const qB = [{ re: Math.sqrt(aProb), im: 0 }, { re: Math.sqrt(1 - aProb), im: 0 }];
  return { qA, qB };
}

// ─────────────────────────────────────────────────────────────
// SIMPLE SEEDABLE RNG (mulberry32) — reproducible runs
// ─────────────────────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────
// TRIAL LOOP
// ─────────────────────────────────────────────────────────────

const rng = mulberry32(0xC0FFEE);

// Joint outcome counts: [A0B0, A0B1, A1B0, A1B1]
const quantumCounts = [0, 0, 0, 0];
const classicalCounts = [0, 0, 0, 0];
let entStrengthSum = 0;

for (let trial = 0; trial < N_TRIALS; trial++) {
  let joint = freshQuantumJoint();
  let { qA, qB } = freshClassicalPair();

  for (let cyc = 0; cyc < N_CYCLES; cyc++) {
    const { deltaA, deltaB, actionA, actionB } = sampleCycleDeltas(rng);
    const thetaA = rotationTheta(deltaA, 15, entangled.aDriverDirection);
    const thetaB = rotationTheta(deltaB, 10, entangled.bDriverDirection);
    const phaseA = actionPhase(actionA);
    const phaseB = actionPhase(actionB);

    // Quantum arm: correlated joint state, local rotations.
    joint = applyLocalRotation(joint, "A", thetaA, phaseA);
    joint = applyLocalRotation(joint, "B", thetaB, phaseB);

    // Classical arm: same rotations, applied independently.
    qA = rotate(qA, thetaA, phaseA);
    qB = rotate(qB, thetaB, phaseB);
  }

  entStrengthSum += entanglementStrength(joint);

  // Quantum arm measurement — A first, conditions B (matches production).
  const aMeasurement = measureA(joint, rng);
  const bCollapse = collapseQubit(aMeasurement.conditionedB, ["0", "1"], rng);
  const qIdx = aMeasurement.outcomeIndex * 2 + bCollapse.outcomeIndex;
  quantumCounts[qIdx]++;

  // Classical arm measurement — independent.
  const aCollapse = collapseQubit(qA, ["0", "1"], rng);
  const bCollapseClassical = collapseQubit(qB, ["0", "1"], rng);
  const cIdx = aCollapse.outcomeIndex * 2 + bCollapseClassical.outcomeIndex;
  classicalCounts[cIdx]++;
}

// ─────────────────────────────────────────────────────────────
// STATISTICS — chi-square test of independence, 2x2 table, df=1
// ─────────────────────────────────────────────────────────────

function normalCdf(z) {
  // Abramowitz-Stegun 7.1.26 erf approximation.
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.SQRT2;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * z);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

function chiSquareIndependence(counts) {
  const [n00, n01, n10, n11] = counts;
  const total = n00 + n01 + n10 + n11;
  const rowA0 = n00 + n01, rowA1 = n10 + n11;
  const colB0 = n00 + n10, colB1 = n01 + n11;
  const expected = [
    (rowA0 * colB0) / total, (rowA0 * colB1) / total,
    (rowA1 * colB0) / total, (rowA1 * colB1) / total,
  ];
  let stat = 0;
  for (let i = 0; i < 4; i++) {
    if (expected[i] > 0) stat += ((counts[i] - expected[i]) ** 2) / expected[i];
  }
  // df=1: p = 2*(1 - Phi(sqrt(stat)))
  const p = 2 * (1 - normalCdf(Math.sqrt(stat)));
  return { stat, p, expected, observed: counts, total };
}

function correlationGap(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  const p = counts.map((c) => c / total);
  const pA0 = p[0] + p[1], pB0 = p[0] + p[2];
  const productJoint = [pA0 * pB0, pA0 * (1 - pB0), (1 - pA0) * pB0, (1 - pA0) * (1 - pB0)];
  return p.reduce((sum, pi, i) => sum + Math.abs(pi - productJoint[i]), 0) / 2; // TV distance
}

const quantumStats = chiSquareIndependence(quantumCounts);
const classicalStats = chiSquareIndependence(classicalCounts);
const quantumGap = correlationGap(quantumCounts);
const classicalGap = correlationGap(classicalCounts);

// ─────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────

const pct = (n, total) => `${((n / total) * 100).toFixed(1)}%`;
const fmtP = (p) => (p < 0.0001 ? "< 0.0001" : p.toFixed(4));

console.log(`\n${"═".repeat(72)}`);
console.log(`QUANTUM vs. CLASSICAL MODEL COMPARISON — ${scenario.meta?.id ?? scenarioPath}`);
console.log(`${"═".repeat(72)}`);
console.log(`Entangled pair: ${entangled.aId} (${entangled.aAxis.join("/")}) x ${entangled.bId} (${entangled.bAxis.join("/")})`);
console.log(`Trials: ${N_TRIALS}   Cycles/trial: ${N_CYCLES}   Initial marginal (axis[0]): ${(aProb * 100).toFixed(1)}%`);
console.log(`Mean entanglement strength at collapse: ${(entStrengthSum / N_TRIALS).toFixed(4)}`);

console.log(`\n── QUANTUM ARM (entangled joint state) ──`);
console.log(`  Joint outcome counts [A0B0, A0B1, A1B0, A1B1]: [${quantumCounts.join(", ")}]`);
console.log(`  As %: [${quantumCounts.map((n) => pct(n, N_TRIALS)).join(", ")}]`);
console.log(`  Total-variation gap from independence: ${quantumGap.toFixed(4)}`);
console.log(`  Chi-square(1) = ${quantumStats.stat.toFixed(2)}, p = ${fmtP(quantumStats.p)}`);

console.log(`\n── CLASSICAL ARM (product state, identical inputs) ──`);
console.log(`  Joint outcome counts [A0B0, A0B1, A1B0, A1B1]: [${classicalCounts.join(", ")}]`);
console.log(`  As %: [${classicalCounts.map((n) => pct(n, N_TRIALS)).join(", ")}]`);
console.log(`  Total-variation gap from independence: ${classicalGap.toFixed(4)}`);
console.log(`  Chi-square(1) = ${classicalStats.stat.toFixed(2)}, p = ${fmtP(classicalStats.p)}`);

console.log(`\n── VERDICT ──`);
const quantumSignificant = quantumStats.p < 0.01;
const classicalNull = classicalStats.p >= 0.01;
if (quantumSignificant && classicalNull) {
  console.log(`  ✅ Signature confirmed on synthetic inputs: the entangled arm shows a`);
  console.log(`     statistically significant joint-outcome correlation (p ${fmtP(quantumStats.p)})`);
  console.log(`     that the classical arm, given IDENTICAL decision inputs, does not`);
  console.log(`     (p ${fmtP(classicalStats.p)}). The mechanism does what the theory predicts.`);
} else if (!quantumSignificant) {
  console.log(`  ⚠️  Entangled arm did NOT reach significance (p ${fmtP(quantumStats.p)}) — check`);
  console.log(`     alpha/entanglement strength, trial count, or cycle count.`);
} else {
  console.log(`  ⚠️  Classical arm ALSO shows significant correlation (p ${fmtP(classicalStats.p)}) —`);
  console.log(`     something is leaking shared state between arms; investigate before trusting gap.`);
}
console.log(`\n  Reminder: this run used SYNTHETIC decision deltas (see file header). It`);
console.log(`  demonstrates the mechanism's statistical signature, not yet a real-world finding.`);
console.log(`${"═".repeat(72)}\n`);

// Machine-readable output alongside the console report.
const outPath = new URL("./quantum-vs-classical-results.json", import.meta.url);
const fs = await import("node:fs/promises");
await fs.writeFile(
  outPath,
  JSON.stringify(
    {
      scenario: scenario.meta?.id ?? scenarioPath,
      nTrials: N_TRIALS,
      nCycles: N_CYCLES,
      initialMarginal: aProb,
      meanEntanglementStrength: entStrengthSum / N_TRIALS,
      quantum: quantumStats,
      classical: classicalStats,
      quantumGap,
      classicalGap,
      syntheticInputCaveat: "Decision deltas are synthetic (uniform, production-matched bounds), not real logged Claude decisions. See file header.",
    },
    null,
    2
  )
);
console.log(`Full results written to ${outPath.pathname}\n`);
