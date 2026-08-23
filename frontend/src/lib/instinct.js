/**
 * instinct.js — the Quantum Instinct Layer.
 *
 * WHAT THIS IS NOT: a second copy of quantum.js. quantum.js (Layer 1) models
 * REASONED belief — a nation's posture, updated by the specific arguments an
 * agent makes to itself, unitary rotation by unitary rotation, in an order
 * that matters. That is deliberation: language and ideology already have
 * hold of it (see agents.js's quantumNarrative, which is fed straight into
 * the LLM's own reasoning).
 *
 * This module models something upstream of that — the pre-deliberative
 * pressure that decides whether a guardian council or a king overrides the
 * whole reasoned process before it ever reaches a vote. Instinct, in the
 * sense this project's design notes use the word: what acts before
 * language and ideology get hold of it. A body doesn't deliberate its way
 * through a decision like this; it's already leaning one way by the time
 * deliberation starts. NationDAO.sol's guardianVeto()/royalVeto() are the
 * one place in this codebase where a single actor makes exactly that kind
 * of call — not a tallied plurality (castVote()'s for/against/abstain
 * buckets, the classical, discrete machinery everything else in this
 * project's voting system runs through), but one gut-level yes/no.
 *
 * Built on the `quantum-circuit` gate-simulator package on purpose, not
 * quantum.js's hand-rolled complex-amplitude math — this layer needs to
 * stay structurally distinct from the reasoned-belief engine it sits
 * upstream of, not a relabeled copy of it.
 *
 * ─────────────────────────────────────────────────────────────
 * THE CIRCUIT
 *
 * One instinct qubit per veto-capable nation. |0> = VETO, |1> = ALLOW.
 *
 *   1. RY(theta) — this nation's live governance pressure (the same
 *      hardlinerPressure/reformPressure fields agents.js already reads to
 *      drive Layer 1's posture qubit, just never before wired to an actual
 *      decision) rotates the instinct qubit, theta chosen so pressure=0
 *      lands at 100% ALLOW, pressure=100 at 100% VETO, and pressure=50 at
 *      an honest 50/50 — see pressureToTheta(). Note what that means: the
 *      "pre-ideological ground" (Chapter 1) isn't a ritual starting
 *      Hadamard bolted on before the real content arrives — it's what
 *      genuinely falls out of this mapping exactly when the pressure
 *      itself is unresolved. Superposition here is earned by the actual
 *      state of the situation, not staged.
 *   2. (entangled nations only) RY + CX on a second wire — the self
 *      discovers it was never alone: for a nation whose posture is
 *      entangled with another's (Iran/Israel today), a second qubit
 *      carries the other side's live readout (same pressureToTheta
 *      mapping), and a CNOT couples this nation's instinct qubit to it.
 *      After that gate the two are genuinely correlated — measuring one
 *      changes the other's remaining distribution — not sealed off from
 *      each other the way two independent RY rotations would be. The
 *      instinct to veto is never an independent fact about one nation in
 *      isolation.
 *
 *      Be precise about what this one CX actually buys, though, rather
 *      than overclaiming: worked out algebraically (and checked against
 *      the installed package), the post-CX marginal on wire 0 comes out to
 *      entangledReadout * (this nation's own unentangled P(ALLOW)) +
 *      (1 - entangledReadout) * (that same probability, flipped). That's a
 *      real correlation — measuring the partner's wire first genuinely
 *      changes what's left for this nation's wire, same operational
 *      content as measureA() in quantum.js — but it's the plain
 *      consequence of the simplest possible entangling gate, not a
 *      hand-tuned "more hardline partner -> more veto-prone" curve. Sanity
 *      check its direction against real scenario intuition (does an
 *      entangledReadout near 1 actually feel right for Iran's guardian
 *      instinct when Israel is near-certainly hawkish?) before treating
 *      this coupling as validated content, the same bar markets.js and
 *      agents.js already hold their own causal stories to.
 *
 * ─────────────────────────────────────────────────────────────
 * ON "GENUINE INDETERMINACY"
 *
 * Read this before reusing that phrase anywhere near this module.
 * quantum-circuit's own measure()/measureAll() call Math.random() with no
 * way to swap it out (checked against the installed package — there is no
 * seed or rng hook). That means running this circuit end-to-end with the
 * library's own measurement is a classical PRNG wearing a circuit diagram —
 * exactly the "classical system pretending to be quantum" this project's
 * design notes warn about. So readInstinct() below does NOT use the
 * library's measure functions. It reads circuit.probability(wire) — a real,
 * deterministic Born-rule number the simulator computes honestly — and
 * takes the actual sample itself through an injectable rng, the same
 * pattern quantum.js's collapseQubit() already uses.
 *
 * TIER 1, DONE (2026-08-23): that seam is now filled by default.
 * readInstinct()/proposeVetoInstinct() default their rng to
 * quantumRandomFloat() (quantumRng.js) — a real sample from the ANU
 * Quantum Random Numbers Server, a physical experiment (laser
 * vacuum-fluctuation measurement), not a relabeled PRNG. It falls back to
 * Math.random() on any failure (offline, rate-limited, slow) and every
 * reading carries which one actually happened (`entropySource`,
 * `entropyDetail`) — never silently wears a label it didn't earn.
 *
 * BE PRECISE ABOUT WHAT TIER 1 DOES NOT BUY: the RY/CX circuit math above
 * — including the entangling CX gate — is still exact classical
 * simulation. Only the final sample against that simulated distribution is
 * now physically sourced. The entanglement itself becoming physically
 * real (running this exact circuit on an actual QPU) is Tier 2, and is
 * NOT done here — see quantum-orch-or's already-working
 * QiskitRuntimeService connection for where that would plug in. Until
 * Tier 2 lands, keep saying "quantum-modeled, real-entropy-sampled" — not
 * "genuine indeterminacy" outright — for what this module produces.
 *
 * ─────────────────────────────────────────────────────────────
 * SCOPE OF THIS DRAFT
 *
 * This module builds and reads the circuit only. It does not call
 * guardianVeto()/royalVeto(), and it is not yet wired into agents.js's
 * decision cycle or any UI — proposeVetoInstinct() returns a proposed
 * reading for a human to weigh against the AI agent's own reasoned
 * decision, same "researcher reviews before it goes on-chain" boundary
 * this project already holds at every other on-chain write.
 */

import QuantumCircuit from "quantum-circuit";
import { quantumRandomFloat } from "./quantumRng.js";

const clampUnit = (p) => Math.min(1, Math.max(0, p));

/**
 * A 0–100 governance-pressure field, as an RY angle applied to a qubit
 * starting at |0> (VETO). Chosen so probability(ALLOW) = 1 - pressure/100
 * exactly (verified below, not just approximately): pressure=0 -> 100%
 * ALLOW, pressure=100 -> 100% VETO, pressure=50 -> genuine 50/50.
 *
 *   P(ALLOW) = sin²(theta/2)  [standard RY-from-|0> result]
 *   want:  sin²(theta/2) = 1 - pressure/100
 *   =>     theta = 2 * asin(sqrt(1 - pressure/100))
 *
 * (An earlier draft of this function used theta = (pressure/100)*PI
 * directly on a Hadamard-prepared qubit — that composition is NOT
 * monotonic in pressure (it peaks at pressure=50 and returns to 50/50 at
 * BOTH pressure=0 and pressure=100). Caught by manual smoke-testing
 * against the installed quantum-circuit package before this landed; see
 * the regression test in __tests__/instinct.test.js.)
 */
export function pressureToTheta(pressureValue) {
  const allowProbability = 1 - clampUnit(pressureValue / 100);
  return 2 * Math.asin(Math.sqrt(allowProbability));
}

/**
 * Build the instinct circuit for one nation.
 *
 * @param pressure          this nation's own driver field value, 0–100
 *                          (e.g. Iran's hardlinerPressure, Saudi's
 *                          reformPressure — whatever scenario.aiAgents
 *                          already names as that nation's driver).
 * @param entangledReadout  the OTHER side's current axis[0] probability
 *                          (0–1), e.g. marginalB(quantum.entangledPair)[0]
 *                          from agents.js — or null/undefined for a
 *                          standalone nation (no entangled partner).
 */
export function buildInstinctCircuit({ pressure, entangledReadout = null }) {
  const circuit = new QuantumCircuit(entangledReadout != null ? 2 : 1);

  circuit.addGate("ry", 0, 0, { params: { theta: pressureToTheta(pressure) } });

  if (entangledReadout != null) {
    circuit.addGate("ry", 0, 1, { params: { theta: pressureToTheta(entangledReadout * 100) } });
    circuit.addGate("cx", 1, [1, 0]); // control = other nation's wire, target = this nation's instinct wire
  }

  return circuit;
}

/**
 * Run the circuit and take one honest reading of wire 0 — see the
 * "GENUINE INDETERMINACY" note above for why this doesn't call the
 * library's own measure()/measureAll(). Async because the default rng
 * (quantumRandomFloat) is a real network call; rng may return either a
 * plain number (the old synchronous contract every existing test still
 * uses, `() => 0.5`) or `{value, source, detail}` (quantumRandomFloat's
 * shape) — either is awaited, so a sync fn works unchanged. Pass a
 * different rng to change the entropy source honestly rather than
 * relabeling what this one produces.
 */
export async function readInstinct(circuit, labels = ["VETO", "ALLOW"], rng = quantumRandomFloat) {
  circuit.run();
  const pAllow = circuit.probability(0); // P(wire 0 = |1>), computed pre-collapse
  const sample = await rng();
  const { value, source = "injected", detail } = typeof sample === "number" ? { value: sample } : sample;
  const outcomeIndex = value < pAllow ? 1 : 0;
  return {
    outcome: labels[outcomeIndex],
    outcomeIndex,
    probabilities: { [labels[0]]: 1 - pAllow, [labels[1]]: pAllow },
    circuitDiagram: circuit.exportSVG(false),
    entropySource: source,
    ...(detail ? { entropyDetail: detail } : {}),
  };
}

function describeInstinct(nationName, pressureField, pressureValue, entangledWith, reading) {
  const pct = Math.round(reading.probabilities.ALLOW * 100);
  const base = `${nationName}'s instinct reads ${pct}% ALLOW / ${100 - pct}% VETO, driven by its own ${pressureField} (${pressureValue}/100)`;
  const tail = entangledWith
    ? `, entangled with ${entangledWith}'s live posture — this is not an independent fact about ${nationName} alone.`
    : ", read standalone — no entangled partner for this nation in this scenario.";
  const entropy =
    reading.entropySource === "anu-qrng"
      ? " Collapse sampled from a real quantum process (ANU QRNG)."
      : reading.entropySource === "math-random-fallback"
        ? ` Collapse sampled from a classical PRNG fallback (${reading.entropyDetail ?? "reason not recorded"}), not real entropy this reading.`
        : "";
  return base + tail + entropy;
}

/**
 * Propose a veto instinct for a nation. Does NOT call guardianVeto()/
 * royalVeto() — returns a proposed reading for a human to weigh against the
 * AI agent's own reasoned decision before anything goes on-chain, matching
 * this project's existing on-chain-write review boundary.
 *
 * @param nation             { id, name } — the veto-capable nation.
 * @param pressureField      name of the driver field this reading used
 *                            (for the audit trail — e.g. "hardlinerPressure").
 * @param pressureValue       that field's current value, 0–100.
 * @param entangledWith       { name, axis0Probability } of the entangled
 *                            partner nation, or null for a standalone nation.
 * @param rng                 injectable entropy source — see readInstinct().
 *                            Defaults to quantumRandomFloat (real ANU QRNG
 *                            entropy, PRNG fallback on failure).
 */
export async function proposeVetoInstinct({ nation, pressureField, pressureValue, entangledWith = null, rng = quantumRandomFloat }) {
  const circuit = buildInstinctCircuit({
    pressure: pressureValue,
    entangledReadout: entangledWith?.axis0Probability ?? null,
  });
  const reading = await readInstinct(circuit, ["VETO", "ALLOW"], rng);
  return {
    nationId: nation.id,
    driverField: pressureField,
    driverValue: pressureValue,
    entangledWithNationId: entangledWith?.nationId ?? null,
    ...reading,
    note: describeInstinct(nation.name, pressureField, pressureValue, entangledWith?.name, reading),
  };
}
