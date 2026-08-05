/**
 * NationAgent — wraps server-side Claude calls for a single nation.
 *
 * Usage:
 *   const agent = new NationAgent("iran");
 *   const result = await agent.decide(worldState);
 *   // result: { nation, cycle, decision: { primaryAction, metricDeltas, reasoning, ... }, usage }
 *
 * Static helper:
 *   const all = await NationAgent.runAll(worldState);
 *   // all: { iran, israel, saudi_arabia } — all three decisions in parallel
 */

import {
  entangledPair, marginalA, marginalB, entanglementStrength,
  coherenceA, coherenceB, coherence, applyLocalRotation, measureA,
  collapseQubit, probabilities, rotate,
} from "./quantum";
import { initMarketBeliefs, marketReadout, evolveAndCollapseMarkets } from "./markets";

export { initMarketBeliefs, marketReadout } from "./markets";

const SERVER_URL = "/api"; // Vite proxies /api → localhost:3001

export class NationAgent {
  constructor(nationId) {
    this.nationId = nationId;
  }

  async decide(worldState) {
    const res = await fetch(`${SERVER_URL}/agent/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nation: this.nationId, worldState }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Agent [${this.nationId}] failed: ${err.error}`);
    }

    return res.json();
  }

  // Run all three nation agents in parallel, return results keyed by nationId
  static async runAll(worldState) {
    const nations = ["iran", "israel", "saudi_arabia"];
    const agents  = nations.map(id => new NationAgent(id));

    const results = await Promise.allSettled(agents.map(a => a.decide(worldState)));

    return Object.fromEntries(
      nations.map((id, i) => {
        const r = results[i];
        return [id, r.status === "fulfilled" ? r.value : { error: r.reason?.message }];
      })
    );
  }
}


// ─────────────────────────────────────────────────────────────
// QUANTUM BELIEF STATE
//
// Each nation's posture on its central axis is a probability
// amplitude, not a fixed scalar — see lib/quantum.js for the engine
// and quantum_extension memory for the design rationale. Iran
// (hardline <-> pragmatic) and Israel (hawkish <-> dovish) are
// entangled — a structural encoding of the security dilemma, where
// neither posture is fully independent of the other. Saudi Arabia
// (bold <-> cautious) is a standalone qubit — the hedging nation,
// per its own operational code.
//
// The state evolves (unitary rotations) each cycle as agent
// decisions land, and collapses (Born-rule measurement) exactly once,
// at commit — see evolveAndCollapseQuantumState() in applyDecisions().
// ─────────────────────────────────────────────────────────────

const clampUnit = (p) => Math.min(1, Math.max(0, p));

export function initQuantumBeliefs(scenario) {
  const nations = Object.fromEntries(scenario.nations.map(n => [n.id, n]));
  const hardlineProb = clampUnit(nations.iran.governance.hardlinerPressure / 100);
  const boldProb      = clampUnit(nations.saudi_arabia.governance.reformPressure / 100);

  // alpha sets BOTH Iran's starting marginal (hardline probability) and how
  // entangled Iran/Israel start out: a near-certain Iran leaves little room
  // for genuine correlation; a 50/50 Iran (alpha = PI/4) is maximally
  // entangled with Israel. That coupling is intentional, not incidental —
  // an unresolved Iran is exactly the case where Israel's posture can't be
  // described independently of it.
  const alpha = Math.acos(Math.sqrt(hardlineProb));

  return {
    // Joint 2-qubit state, basis [hardline&hawkish, hardline&dovish, pragmatic&hawkish, pragmatic&dovish]
    iranIsrael: entangledPair(alpha),
    // Standalone qubit, basis [bold, cautious]
    saudi: [{ re: Math.sqrt(boldProb), im: 0 }, { re: Math.sqrt(1 - boldProb), im: 0 }],
  };
}

function qubitReadout(qubit, labels) {
  const [p0, p1] = probabilities(qubit);
  return { [labels[0]]: p0, [labels[1]]: p1 };
}

// Same shape as qubitReadout(), but for values that are already plain
// probabilities (e.g. a marginal read off an entangled joint state) rather
// than a complex amplitude pair.
function probReadout([p0, p1], labels) {
  return { [labels[0]]: p0, [labels[1]]: p1 };
}

// Deterministic phase from an action id — different action types rotate the
// belief qubit around different axes, so the SAME two decisions landing in a
// different order can compose to a different posture. Not a display gimmick:
// this is the mechanism that produces the order effects described in
// lib/quantum.js.
function actionPhase(actionId = "") {
  let h = 0;
  for (let i = 0; i < actionId.length; i++) h = (h * 31 + actionId.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000 * 2 * Math.PI;
}

// Human-readable narrative injected into the nation's system prompt so the
// LLM's in-character reasoning is actually informed by the quantum state,
// not just decorated by it afterward.
function describeIranQuantumState(joint) {
  const [pHardline, pPragmatic] = marginalA(joint);
  const strength = entanglementStrength(joint);
  const localCoherence = coherenceA(joint);
  return `Your posture is a live superposition, not a fixed choice: ${Math.round(pHardline*100)}% amplitude on HARDLINE, ${Math.round(pPragmatic*100)}% on PRAGMATIC. It does not resolve until you act and the cycle is committed. ` +
    `This is entangled with Israel's posture (entanglement strength ${strength.toFixed(2)}) — their outcome and yours are correlated in a way that isn't reducible to either side's independent probability. ` +
    (localCoherence < 0.15
      ? `Notably, viewed on your own, your posture currently reads almost like ordinary uncertainty (local coherence ${localCoherence.toFixed(2)}) — the real quantum effect isn't inside your own head, it's in the correlation with Israel.`
      : `Your own posture still carries meaningful internal superposition (local coherence ${localCoherence.toFixed(2)}), separate from the entanglement with Israel.`);
}

function describeIsraelQuantumState(joint) {
  const [pHawkish, pDovish] = marginalB(joint);
  const strength = entanglementStrength(joint);
  const localCoherence = coherenceB(joint);
  return `Your posture is a live superposition, not a fixed choice: ${Math.round(pHawkish*100)}% amplitude on HAWKISH, ${Math.round(pDovish*100)}% on DOVISH. It does not resolve until you act and the cycle is committed. ` +
    `This is entangled with Iran's posture (entanglement strength ${strength.toFixed(2)}) — your outcome and theirs are correlated in a way that isn't reducible to either side's independent probability. ` +
    (localCoherence < 0.15
      ? `Notably, viewed on your own, your posture currently reads almost like ordinary uncertainty (local coherence ${localCoherence.toFixed(2)}) — the real quantum effect isn't inside your own head, it's in the correlation with Iran.`
      : `Your own posture still carries meaningful internal superposition (local coherence ${localCoherence.toFixed(2)}), separate from the entanglement with Iran.`);
}

function describeSaudiQuantumState(qubit) {
  const [pBold, pCautious] = probabilities(qubit);
  const c = coherence(qubit);
  return `Your posture is a live superposition, not a fixed choice: ${Math.round(pBold*100)}% amplitude on BOLD, ${Math.round(pCautious*100)}% on CAUTIOUS (coherence ${c.toFixed(2)}). Unlike Iran and Israel, your posture is not entangled with either of theirs — you hedge independently, per your own operational code.`;
}


// ─────────────────────────────────────────────────────────────
// WORLD STATE BUILDER
//
// Converts the scenario config + current simulation state
// into the flat worldState object the server templates expect.
// ─────────────────────────────────────────────────────────────

export function buildWorldState(scenario, simState, cycle, agentMemory = {}) {
  const nations = Object.fromEntries(scenario.nations.map(n => [n.id, n]));
  const iran    = nations["iran"];
  const israel  = nations["israel"];
  const saudi   = nations["saudi_arabia"];

  const quantum = agentMemory.quantum || initQuantumBeliefs(scenario);
  const markets = agentMemory.markets || initMarketBeliefs();

  return {
    cycle,

    // Layer 2 (economic field) readout — downstream of the political
    // layer, not fed back into the nation prompts (one-directional for now).
    markets: marketReadout(markets),

    // Global metrics from simulation state
    stability:      simState.stability,
    proxyActivity:  simState.proxy,
    tradeVolume:    simState.trade,
    conflictEvents: simState.conflicts,
    dealIntegrity:  simState.dealIntegrity,

    // Iran nation state — merge scenario defaults with any agent memory overrides
    iran: {
      treasury:              iran.economy.treasury,
      militaryPower:         iran.military.power,
      proxyCapacity:         iran.military.proxyCapacity,
      publicSentiment:       iran.population.sentiment,
      hardlinerPressure:     agentMemory.iran?.hardlinerPressure ?? iran.governance.hardlinerPressure,
      sanctionsReliefPending: iran.economy.sanctionsReliefPending,
      hormuzStatus:          agentMemory.iran?.hormuzStatus     ?? "OPEN",
      nuclearStatus:         agentMemory.iran?.nuclearStatus    ?? "CAPPED",
      quantumBeliefState:    probReadout(marginalA(quantum.iranIsrael), ["hardline", "pragmatic"]),
      quantumNarrative:      describeIranQuantumState(quantum.iranIsrael),
    },

    // Israel nation state
    israel: {
      treasury:        israel.economy.treasury,
      militaryPower:   israel.military.power,
      publicSentiment: agentMemory.israel?.publicSentiment ?? israel.population.sentiment,
      coalitionStatus: agentMemory.israel?.coalitionStatus ?? "STRAINED",
      quantumBeliefState: probReadout(marginalB(quantum.iranIsrael), ["hawkish", "dovish"]),
      quantumNarrative:   describeIsraelQuantumState(quantum.iranIsrael),
    },

    // Saudi Arabia nation state
    saudiArabia: {
      treasury:              saudi.economy.treasury,
      militaryPower:         saudi.military.power,
      publicSentiment:       saudi.population.sentiment,
      reformPressure:        agentMemory.saudiArabia?.reformPressure     ?? saudi.governance.reformPressure,
      oilProductionStance:   agentMemory.saudiArabia?.oilProductionStance ?? "STABLE",
      normalizationStatus:   agentMemory.saudiArabia?.normalizationStatus ?? "STALLED",
      quantumBeliefState:    qubitReadout(quantum.saudi, ["bold", "cautious"]),
      quantumNarrative:      describeSaudiQuantumState(quantum.saudi),
    },
  };
}


// ─────────────────────────────────────────────────────────────
// QUANTUM EVOLUTION + COLLAPSE (runs once per commit)
//
// 1. Fold each agent's decision into the belief state as a unitary
//    rotation, IN THE ORDER the agents were resolved (iran -> israel
//    -> saudi). That resolution order is a real causal input here, not
//    incidental — the same three decisions landing in a different
//    order can compose to a different posture (see quantum.js).
// 2. Measure at commit (Born rule): Iran first, which — because the
//    two are entangled — conditions Israel's remaining distribution
//    before Israel itself is measured. Saudi Arabia, unentangled,
//    measures independently.
// 3. Where Iran and Israel's collapsed postures land in mutual
//    hardline+hawkish or pragmatic+dovish alignment, apply a small
//    additional "entangled escalation / entangled de-escalation"
//    effect on top of the classical LLM-driven deltas — the one
//    concrete, falsifiable prediction this layer adds: correlated
//    collapse should coincide with faster-than-additive movement.
// ─────────────────────────────────────────────────────────────

export function evolveAndCollapseQuantumState(quantum, decisions, rng = Math.random) {
  let { iranIsrael, saudi } = quantum;

  const iranD   = decisions.iran?.decision;
  const israelD = decisions.israel?.decision;
  const saudiD  = decisions.saudi_arabia?.decision;

  if (iranD) {
    const delta = iranD.metricDeltas?.hardlinerPressure ?? 0;
    const magnitude = Math.min(1, Math.abs(delta) / 15) * (Math.PI / 6);
    // positive delta = more hardliner pressure = push toward index0 (hardline) = negative theta
    const theta = delta >= 0 ? -magnitude : magnitude;
    iranIsrael = applyLocalRotation(iranIsrael, "A", theta, actionPhase(iranD.primaryAction));
  }
  if (israelD) {
    const delta = israelD.metricDeltas?.publicSentiment ?? 0;
    // falling public sentiment = rising threat perception = push toward index0 (hawkish)
    const magnitude = Math.min(1, Math.abs(delta) / 10) * (Math.PI / 6);
    const theta = delta <= 0 ? -magnitude : magnitude;
    iranIsrael = applyLocalRotation(iranIsrael, "B", theta, actionPhase(israelD.primaryAction));
  }
  if (saudiD) {
    const delta = saudiD.metricDeltas?.reformPressure ?? 0;
    // rising reform pressure = push toward index0 (bold)
    const magnitude = Math.min(1, Math.abs(delta) / 10) * (Math.PI / 6);
    const theta = delta >= 0 ? -magnitude : magnitude;
    saudi = rotate(saudi, theta, actionPhase(saudiD.primaryAction));
  }

  // Diagnostics captured BEFORE collapse — this is the last look at the
  // genuine superposition, useful for the research record even though
  // the categorical outcome below is what feeds the cascade.
  const preCollapse = {
    iranProbabilities:   probReadout(marginalA(iranIsrael), ["hardline", "pragmatic"]),
    israelProbabilities: probReadout(marginalB(iranIsrael), ["hawkish", "dovish"]),
    entanglementStrength: entanglementStrength(iranIsrael),
    saudiProbabilities:  qubitReadout(saudi, ["bold", "cautious"]),
  };

  const iranMeasurement = measureA(iranIsrael, rng);
  const iranOutcome = iranMeasurement.outcomeIndex === 0 ? "hardline" : "pragmatic";
  const israelCollapse = collapseQubit(iranMeasurement.conditionedB, ["hawkish", "dovish"], rng);
  const saudiCollapse  = collapseQubit(saudi, ["bold", "cautious"], rng);

  // Rebuild a clean one-hot joint state from both collapsed outcomes.
  const oneHot = [0, 0, 0, 0];
  oneHot[iranMeasurement.outcomeIndex * 2 + israelCollapse.outcomeIndex] = 1;
  const collapsedJoint = oneHot.map(v => (v ? { re: 1, im: 0 } : { re: 0, im: 0 }));

  let entangledEffect = null;
  if (iranOutcome === "hardline" && israelCollapse.outcome === "hawkish") {
    entangledEffect = { stability: -2, conflictEvents: +1, label: "entangled escalation" };
  } else if (iranOutcome === "pragmatic" && israelCollapse.outcome === "dovish") {
    entangledEffect = { stability: +2, dealIntegrity: +1, label: "entangled de-escalation" };
  }

  return {
    newQuantum: { iranIsrael: collapsedJoint, saudi: saudiCollapse.collapsedState },
    event: {
      iran: iranOutcome,
      israel: israelCollapse.outcome,
      saudi: saudiCollapse.outcome,
      preCollapse,
      entangledEffect,
    },
  };
}


// ─────────────────────────────────────────────────────────────
// DECISION APPLIER
//
// Takes the three agent decisions and applies their metricDeltas
// to the simulation state. Also updates agent memory for
// nation-specific state (hormuzStatus, coalitionStatus, etc.)
// that doesn't live in the on-chain metrics.
//
// Returns { newSimState, newAgentMemory }.
// ─────────────────────────────────────────────────────────────

export function applyDecisions(simState, decisions, agentMemory = {}, cycle = 0) {
  const s = { ...simState };
  const mem = structuredClone(agentMemory);

  const clamp = (v, min, max) => Math.min(max, Math.max(min, Math.round(v)));

  for (const [nation, result] of Object.entries(decisions)) {
    if (result.error || !result.decision) continue;

    const d = result.decision;
    const deltas = d.metricDeltas || {};

    // Apply shared metric deltas — accumulate across all three agents
    if (deltas.stability      != null) s.stability      = clamp(s.stability      + deltas.stability,      0, 100);
    if (deltas.proxyActivity  != null) s.proxy          = clamp(s.proxy          + deltas.proxyActivity,  0, 100);
    if (deltas.tradeVolume    != null) s.trade          = clamp(s.trade          + deltas.tradeVolume,     0, 500);
    if (deltas.conflictEvents != null) s.conflicts      = clamp(s.conflicts      + deltas.conflictEvents,  0, 999);
    if (deltas.dealIntegrity  != null) s.dealIntegrity  = clamp(s.dealIntegrity  + deltas.dealIntegrity,   0, 100);

    // Persist nation-specific state in agent memory
    if (nation === "iran") {
      mem.iran = mem.iran || {};
      if (d.hormuzStatus)   mem.iran.hormuzStatus   = d.hormuzStatus;
      if (d.nuclearStatus)  mem.iran.nuclearStatus  = d.nuclearStatus;
      if (d.coalitionSignal) mem.iran.coalitionSignal = d.coalitionSignal;
      if (deltas.hardlinerPressure != null) {
        const current = mem.iran.hardlinerPressure ?? 72;
        mem.iran.hardlinerPressure = clamp(current + deltas.hardlinerPressure, 0, 100);
      }
    }

    if (nation === "israel") {
      mem.israel = mem.israel || {};
      if (d.coalitionStatus) mem.israel.coalitionStatus = d.coalitionStatus;
      if (d.existentialFrameActive != null) mem.israel.existentialFrameActive = d.existentialFrameActive;
      if (deltas.publicSentiment != null) {
        const current = mem.israel.publicSentiment ?? 58;
        mem.israel.publicSentiment = clamp(current + deltas.publicSentiment, 0, 100);
      }
    }

    if (nation === "saudi_arabia") {
      mem.saudiArabia = mem.saudiArabia || {};
      if (d.oilProductionStance)  mem.saudiArabia.oilProductionStance  = d.oilProductionStance;
      if (d.normalizationStatus)  mem.saudiArabia.normalizationStatus  = d.normalizationStatus;
      if (d.coalitionSignal)      mem.saudiArabia.coalitionSignal      = d.coalitionSignal;
      if (deltas.reformPressure != null) {
        const current = mem.saudiArabia.reformPressure ?? 55;
        mem.saudiArabia.reformPressure = clamp(current + deltas.reformPressure, 0, 100);
      }
    }
  }

  // Cascade: if Iran closes Hormuz, trade collapses and stability drops hard
  if (mem.iran?.hormuzStatus === "CLOSED") {
    s.trade     = clamp(s.trade     - 40, 0, 500);
    s.stability = clamp(s.stability - 8,  0, 100);
  }

  // Cascade: if Iran goes to full nuclear breakout, dealIntegrity → 0
  if (mem.iran?.nuclearStatus === "FULL_BREAKOUT") {
    s.dealIntegrity = 0;
  }

  // Cascade: if Israel existential frame is active, conflict events spike
  if (mem.israel?.existentialFrameActive) {
    s.conflicts = clamp(s.conflicts + 3, 0, 999);
  }

  // Quantum layer: evolve the belief state with this cycle's decisions
  // (unitary), then collapse it (Born-rule measurement — this IS the
  // commit-time "measurement event" the quantum_extension design calls
  // for). Where Iran and Israel's collapsed postures land in mutual
  // hardline+hawkish or pragmatic+dovish alignment, apply the small
  // additional entanglement effect on top of the classical deltas above.
  if (!mem.quantum) {
    throw new Error("agentMemory.quantum missing — call initQuantumBeliefs(scenario) when seeding agentMemory");
  }
  const { newQuantum, event } = evolveAndCollapseQuantumState(mem.quantum, decisions);
  mem.quantum = newQuantum;
  mem.quantum.lastEvent = event;

  if (event.entangledEffect) {
    if (event.entangledEffect.stability      != null) s.stability      += event.entangledEffect.stability;
    if (event.entangledEffect.conflictEvents != null) s.conflicts      += event.entangledEffect.conflictEvents;
    if (event.entangledEffect.dealIntegrity  != null) s.dealIntegrity  += event.entangledEffect.dealIntegrity;
  }

  // Layer 2/3: the economic field (oil / rial / riyal, entangled) evolves
  // from this cycle's geopolitical collapse + classical decisions, then
  // collapses itself; the synthetic trader roster's interference then
  // resolves each instrument's price move (see markets.js). One-directional
  // for now — markets read the political layer, not vice versa.
  if (!mem.markets) {
    throw new Error("agentMemory.markets missing — call initMarketBeliefs() when seeding agentMemory");
  }
  const { newMarketState, event: marketEvent } = evolveAndCollapseMarkets(mem.markets, event, decisions, cycle);
  mem.markets = newMarketState;
  mem.markets.lastEvent = marketEvent;

  s.oilPrice   = (s.oilPrice   ?? 100) + marketEvent.oilPriceDelta;
  s.rialIndex  = (s.rialIndex  ?? 100) + marketEvent.rialIndexDelta;
  s.riyalIndex = (s.riyalIndex ?? 100) + marketEvent.riyalIndexDelta;
  s.usGasIndex = (s.usGasIndex ?? 100) + marketEvent.usGasIndexDelta;

  s.stability      = clamp(s.stability,     0, 100);
  s.proxy          = clamp(s.proxy,          0, 100);
  s.trade          = clamp(s.trade,          0, 500);
  s.conflicts      = clamp(s.conflicts,      0, 999);
  s.dealIntegrity  = clamp(s.dealIntegrity,  0, 100);
  s.oilPrice       = clamp(s.oilPrice,       0, 300);
  s.rialIndex      = clamp(s.rialIndex,      0, 300);
  s.riyalIndex     = clamp(s.riyalIndex,     0, 300);
  s.usGasIndex     = clamp(s.usGasIndex,     0, 300);

  return { newSimState: s, newAgentMemory: mem };
}
