/**
 * NationAgent — wraps server-side Claude calls for a single nation.
 *
 * Usage:
 *   const agent = new NationAgent("iran");
 *   const result = await agent.decide(worldState, "middle-east-2026");
 *   // result: { nation, cycle, decision: { primaryAction, metricDeltas, reasoning, ... }, usage }
 *
 * Static helper:
 *   const all = await NationAgent.runAll(scenario, worldState);
 *   // all: keyed by each of scenario.nations' ids — every nation's decision in parallel
 */

import {
  entangledPair, marginalA, marginalB, entanglementStrength,
  coherenceA, coherenceB, coherence, applyLocalRotation, measureA,
  collapseQubit, probabilities, rotate,
} from "./quantum.js";
import { initMarketBeliefs, marketReadout, evolveAndCollapseMarkets } from "./markets.js";

export { initMarketBeliefs, marketReadout } from "./markets.js";

const SERVER_URL = "/api"; // Vite proxies /api → localhost:3001

export class NationAgent {
  constructor(nationId) {
    this.nationId = nationId;
  }

  async decide(worldState, scenarioId) {
    const res = await fetch(`${SERVER_URL}/agent/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nation: this.nationId, worldState, scenarioId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Agent [${this.nationId}] failed: ${err.error}`);
    }

    return res.json();
  }

  // Run every nation agent for this scenario in parallel, return results keyed by nationId
  static async runAll(scenario, worldState) {
    const nations = scenario.nations.map(n => n.id);
    const agents  = nations.map(id => new NationAgent(id));

    const results = await Promise.allSettled(agents.map(a => a.decide(worldState, scenario.meta.id)));

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
// and quantum_extension memory for the design rationale. WHICH pair is
// entangled and which nation hedges as a standalone qubit is a genuine
// per-scenario design decision, not something derivable from the rest
// of the config — it lives in scenario.aiAgents (entangled.aId/bId +
// standalone.id, plus each side's axis labels and which of that
// nation's own governance fields drives its qubit's rotation each
// cycle). See each scenario config's own aiAgents block for the
// reasoning behind that scenario's specific choice.
//
// The state evolves (unitary rotations) each cycle as agent
// decisions land, and collapses (Born-rule measurement) exactly once,
// at commit — see evolveAndCollapseQuantumState() in applyDecisions().
// ─────────────────────────────────────────────────────────────

const clampUnit = (p) => Math.min(1, Math.max(0, p));

export function nationsById(scenario) {
  return Object.fromEntries(scenario.nations.map(n => [n.id, n]));
}

// Read a nation's driver field, applying the config's driverDirection so
// the returned value is always "probability of axis[0]" regardless of
// whether the underlying field rises toward axis[0] or axis[1].
export function driverProbability(nation, driverField, driverDirection) {
  const raw = clampUnit((nation.governance[driverField] ?? 50) / 100);
  return driverDirection === "inverse" ? 1 - raw : raw;
}

export function initQuantumBeliefs(scenario) {
  const nations = nationsById(scenario);
  const { entangled, standalone, peacekeeper } = scenario.aiAgents;

  // alpha sets BOTH side A's starting marginal (axis[0] probability) and
  // how entangled the pair start out: a near-certain A leaves little room
  // for genuine correlation; a 50/50 A (alpha = PI/4) is maximally
  // entangled with B. That coupling is intentional, not incidental — an
  // unresolved A is exactly the case where B's posture can't be described
  // independently of it. Only A's driver matters for the initial state:
  // entangledPair(alpha) is a perfectly-correlated Bell-like state, so B's
  // initial marginal is forced to equal A's by construction — B's own
  // driver field only matters for its PER-CYCLE rotation, in
  // evolveAndCollapseQuantumState() below.
  const aProb = driverProbability(nations[entangled.aId], entangled.aDriverField, entangled.aDriverDirection);
  const alpha = Math.acos(Math.sqrt(aProb));

  const cProb = driverProbability(nations[standalone.id], standalone.driverField, standalone.driverDirection);

  const beliefs = {
    // Joint 2-qubit state, basis [axis0&axis0, axis0&axis1, axis1&axis0, axis1&axis1]
    entangledPair: entangledPair(alpha),
    // Standalone qubit, basis [axis0, axis1]
    standaloneQubit: [{ re: Math.sqrt(cProb), im: 0 }, { re: Math.sqrt(1 - cProb), im: 0 }],
  };

  // Peacekeeper qubit is optional — scenarios without one (e.g. Taiwan
  // Strait, not built yet) just don't get this key, and every consumer
  // below already guards on scenario.aiAgents.peacekeeper existing.
  if (peacekeeper) {
    const pProb = driverProbability(nations[peacekeeper.id], peacekeeper.driverField, peacekeeper.driverDirection);
    beliefs.peacekeeperQubit = [{ re: Math.sqrt(pProb), im: 0 }, { re: Math.sqrt(1 - pProb), im: 0 }];
  }

  return beliefs;
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
export function actionPhase(actionId = "") {
  let h = 0;
  for (let i = 0; i < actionId.length; i++) h = (h * 31 + actionId.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000 * 2 * Math.PI;
}

// Human-readable narrative injected into the nation's system prompt so the
// LLM's in-character reasoning is actually informed by the quantum state,
// not just decorated by it afterward. Generic across every scenario — the
// domain meaning comes entirely from axisLabels/otherNationName, passed in
// from scenario.aiAgents.
function describeEntangledQuantumState(joint, side, axisLabels, otherNationName) {
  const marginal = side === "A" ? marginalA(joint) : marginalB(joint);
  const [p0, p1] = marginal;
  const strength = entanglementStrength(joint);
  const localCoherence = side === "A" ? coherenceA(joint) : coherenceB(joint);
  return `Your posture is a live superposition, not a fixed choice: ${Math.round(p0 * 100)}% amplitude on ${axisLabels[0].toUpperCase()}, ${Math.round(p1 * 100)}% on ${axisLabels[1].toUpperCase()}. It does not resolve until you act and the cycle is committed. ` +
    `This is entangled with ${otherNationName}'s posture (entanglement strength ${strength.toFixed(2)}) — their outcome and yours are correlated in a way that isn't reducible to either side's independent probability. ` +
    (localCoherence < 0.15
      ? `Notably, viewed on your own, your posture currently reads almost like ordinary uncertainty (local coherence ${localCoherence.toFixed(2)}) — the real quantum effect isn't inside your own head, it's in the correlation with ${otherNationName}.`
      : `Your own posture still carries meaningful internal superposition (local coherence ${localCoherence.toFixed(2)}), separate from the entanglement with ${otherNationName}.`);
}

function describeStandaloneQuantumState(qubit, axisLabels) {
  const [p0, p1] = probabilities(qubit);
  const c = coherence(qubit);
  return `Your posture is a live superposition, not a fixed choice: ${Math.round(p0 * 100)}% amplitude on ${axisLabels[0].toUpperCase()}, ${Math.round(p1 * 100)}% on ${axisLabels[1].toUpperCase()} (coherence ${c.toFixed(2)}). Unlike the entangled pair, your posture is not correlated with either of theirs — you hedge independently, per your own operational code.`;
}


// ─────────────────────────────────────────────────────────────
// WORLD STATE BUILDER
//
// Converts the scenario config + current simulation state into the
// flat worldState object the server templates expect. The generic core
// (global metrics, markets readout, quantum readouts/narratives) is
// scenario-agnostic and driven by scenario.aiAgents. Each nation's own
// status-flag vocabulary (hormuzStatus, blockadeStatus, ...) is
// genuinely bespoke content, not a mechanical relabeling of the same
// field — so that part is branched by scenario id below, same as the
// system prompts themselves.
// ─────────────────────────────────────────────────────────────

export function buildWorldState(scenario, simState, cycle, agentMemory = {}) {
  const scenarioId = scenario.meta.id;
  const nations = nationsById(scenario);
  const { entangled, standalone, peacekeeper } = scenario.aiAgents;

  const quantum = agentMemory.quantum || initQuantumBeliefs(scenario);
  const markets = agentMemory.markets || initMarketBeliefs(scenario);

  const aNation = nations[entangled.aId];
  const bNation = nations[entangled.bId];
  const cNation = nations[standalone.id];

  const common = {
    cycle,
    scenarioId,

    // Layer 2 (economic field) readout — downstream of the political
    // layer, not fed back into the nation prompts (one-directional for now).
    markets: marketReadout(markets, scenario),

    // Global metrics from simulation state
    stability:      simState.stability,
    proxyActivity:  simState.proxy,
    tradeVolume:    simState.trade,
    conflictEvents: simState.conflicts,
    dealIntegrity:  simState.dealIntegrity,
  };

  const aState = {
    treasury:           aNation.economy.treasury,
    militaryPower:       aNation.military.power,
    publicSentiment:     aNation.population.sentiment,
    quantumBeliefState:  probReadout(marginalA(quantum.entangledPair), entangled.aAxis),
    quantumNarrative:    describeEntangledQuantumState(quantum.entangledPair, "A", entangled.aAxis, bNation.name),
  };

  const bState = {
    treasury:            bNation.economy.treasury,
    militaryPower:        bNation.military.power,
    publicSentiment:      agentMemory[entangled.bWorldKey]?.publicSentiment ?? bNation.population.sentiment,
    coalitionStatus:      agentMemory[entangled.bWorldKey]?.coalitionStatus ?? "STRAINED",
    quantumBeliefState:   probReadout(marginalB(quantum.entangledPair), entangled.bAxis),
    quantumNarrative:     describeEntangledQuantumState(quantum.entangledPair, "B", entangled.bAxis, aNation.name),
  };

  const cState = {
    treasury:            cNation.economy.treasury,
    militaryPower:        cNation.military.power,
    publicSentiment:      cNation.population.sentiment,
    quantumBeliefState:   qubitReadout(quantum.standaloneQubit, standalone.axis),
    quantumNarrative:     describeStandaloneQuantumState(quantum.standaloneQubit, standalone.axis),
  };

  let pState = null;
  if (peacekeeper && quantum.peacekeeperQubit) {
    const pNation = nations[peacekeeper.id];
    pState = {
      treasury:           pNation.economy.treasury,
      militaryPower:       pNation.military.power,
      publicSentiment:     agentMemory[peacekeeper.worldKey]?.publicSentiment ?? pNation.population.sentiment,
      quantumBeliefState:  qubitReadout(quantum.peacekeeperQubit, peacekeeper.axis),
      quantumNarrative:    describeStandaloneQuantumState(quantum.peacekeeperQubit, peacekeeper.axis),
    };
  }

  if (scenarioId === "middle-east-2026") {
    aState.proxyCapacity         = aNation.military.proxyCapacity;
    aState.hardlinerPressure     = agentMemory[entangled.aWorldKey]?.hardlinerPressure ?? aNation.governance.hardlinerPressure;
    aState.sanctionsReliefPending = aNation.economy.sanctionsReliefPending;
    aState.hormuzStatus          = agentMemory[entangled.aWorldKey]?.hormuzStatus  ?? "OPEN";
    aState.nuclearStatus         = agentMemory[entangled.aWorldKey]?.nuclearStatus ?? "CAPPED";

    cState.reformPressure       = agentMemory[standalone.worldKey]?.reformPressure     ?? cNation.governance.reformPressure;
    cState.oilProductionStance  = agentMemory[standalone.worldKey]?.oilProductionStance ?? "STABLE";
    cState.normalizationStatus  = agentMemory[standalone.worldKey]?.normalizationStatus ?? "STALLED";

    const result = { ...common, [entangled.aWorldKey]: aState, [entangled.bWorldKey]: bState, [standalone.worldKey]: cState };

    if (pState && peacekeeper) {
      pState.sanctionsReliefPending = aNation.economy.sanctionsReliefPending;
      pState.congressionalRatification = agentMemory[peacekeeper.worldKey]?.congressionalRatification ?? "PENDING";
      // diplomaticCapital is the peacekeeper's quantum driver field — must be
      // tracked as a running value (like hardlinerPressure/reformPressure
      // below), not just a static config number, or the qubit only ever
      // rotates on cycle 1 and then sits frozen for the rest of the run.
      // Confirmed the hard way (2026-08-07): ran a real 5-cycle Middle East
      // AI Agent Cycle with the US, and pProbabilities.activelyMediate was
      // locked at exactly 0 from cycle 2 onward — traced to metricDeltas
      // never containing "diplomaticCapital" anywhere the US could set it.
      pState.diplomaticCapital = agentMemory[peacekeeper.worldKey]?.diplomaticCapital ?? nations[peacekeeper.id].governance.diplomaticCapital;
      result[peacekeeper.worldKey] = pState;
    }

    return result;
  }

  if (scenarioId === "taiwan-strait-2026") {
    aState.hardlinerPressure = agentMemory[entangled.aWorldKey]?.hardlinerPressure ?? aNation.governance.hardlinerPressure;
    aState.blockadeStatus    = agentMemory[entangled.aWorldKey]?.blockadeStatus    ?? "OPEN";
    aState.invasionStatus    = agentMemory[entangled.aWorldKey]?.invasionStatus    ?? "NONE";

    cState.reformPressure          = agentMemory[standalone.worldKey]?.reformPressure          ?? cNation.governance.reformPressure;
    cState.chipExportControlStance = agentMemory[standalone.worldKey]?.chipExportControlStance ?? "STABLE";
    cState.securityAlignmentStatus = agentMemory[standalone.worldKey]?.securityAlignmentStatus ?? "STALLED";

    return { ...common, [entangled.aWorldKey]: aState, [entangled.bWorldKey]: bState, [standalone.worldKey]: cState };
  }

  throw new Error(`buildWorldState: unsupported scenario "${scenarioId}" — add a branch here and matching system prompts in server.js`);
}


// ─────────────────────────────────────────────────────────────
// QUANTUM EVOLUTION + COLLAPSE (runs once per commit)
//
// 1. Fold each agent's decision into the belief state as a unitary
//    rotation, IN THE ORDER scenario.nations lists them. That resolution
//    order is a real causal input here, not incidental — the same three
//    decisions landing in a different order can compose to a different
//    posture (see quantum.js).
// 2. Measure at commit (Born rule): side A first, which — because the
//    two are entangled — conditions side B's remaining distribution
//    before B itself is measured. The standalone nation, unentangled,
//    measures independently.
// 3. Where the entangled pair's collapsed postures both land on axis[0]
//    (the tense/escalatory pole, by convention in every scenario's
//    aiAgents config) or both land on axis[1] (the calm pole), apply a
//    small additional "entangled escalation / entangled de-escalation"
//    effect on top of the classical LLM-driven deltas — the one
//    concrete, falsifiable prediction this layer adds: correlated
//    collapse should coincide with faster-than-additive movement.
// ─────────────────────────────────────────────────────────────

// Sign of the rotation angle for a given delta + direction, matching the
// convention already established: a delta that pushes toward axis[0]
// rotates with negative theta, axis[1] with positive theta.
export function rotationTheta(delta, maxAbs, direction) {
  const magnitude = Math.min(1, Math.abs(delta) / maxAbs) * (Math.PI / 6);
  const risingPushesAxis0 = direction !== "inverse";
  const deltaPushesAxis0 = risingPushesAxis0 ? delta >= 0 : delta <= 0;
  return deltaPushesAxis0 ? -magnitude : magnitude;
}

export function evolveAndCollapseQuantumState(scenario, quantum, decisions, rng = Math.random) {
  const { entangled, standalone, peacekeeper } = scenario.aiAgents;
  let joint  = quantum.entangledPair;
  let qubitC = quantum.standaloneQubit;
  let qubitP = quantum.peacekeeperQubit; // may be undefined if this scenario has no peacekeeper

  const aD = decisions[entangled.aId]?.decision;
  const bD = decisions[entangled.bId]?.decision;
  const cD = decisions[standalone.id]?.decision;
  const pD = peacekeeper ? decisions[peacekeeper.id]?.decision : null;

  if (aD) {
    const delta = aD.metricDeltas?.[entangled.aDriverField] ?? 0;
    const theta = rotationTheta(delta, 15, entangled.aDriverDirection);
    joint = applyLocalRotation(joint, "A", theta, actionPhase(aD.primaryAction));
  }
  if (bD) {
    const delta = bD.metricDeltas?.[entangled.bDriverField] ?? 0;
    const theta = rotationTheta(delta, 10, entangled.bDriverDirection);
    joint = applyLocalRotation(joint, "B", theta, actionPhase(bD.primaryAction));
  }
  if (cD) {
    const delta = cD.metricDeltas?.[standalone.driverField] ?? 0;
    const theta = rotationTheta(delta, 10, standalone.driverDirection);
    qubitC = rotate(qubitC, theta, actionPhase(cD.primaryAction));
  }
  // Peacekeeper rotates last, after the three regional actors — a real
  // ordering choice (matches the existing A→B→C convention of resolving
  // in a fixed sequence, not incidental): the US's own posture this cycle
  // is folded in only after seeing how far the local rotations already
  // pushed the state, same non-commutative-order principle as the rest of
  // this engine, just extended one qubit further.
  if (pD && qubitP) {
    const delta = pD.metricDeltas?.[peacekeeper.driverField] ?? 0;
    const theta = rotationTheta(delta, 10, peacekeeper.driverDirection);
    qubitP = rotate(qubitP, theta, actionPhase(pD.primaryAction));
  }

  // Diagnostics captured BEFORE collapse — this is the last look at the
  // genuine superposition, useful for the research record even though
  // the categorical outcome below is what feeds the cascade.
  const preCollapse = {
    aProbabilities:       probReadout(marginalA(joint), entangled.aAxis),
    bProbabilities:       probReadout(marginalB(joint), entangled.bAxis),
    entanglementStrength: entanglementStrength(joint),
    cProbabilities:       qubitReadout(qubitC, standalone.axis),
    ...(peacekeeper && qubitP ? { pProbabilities: qubitReadout(qubitP, peacekeeper.axis) } : {}),
  };

  const aMeasurement = measureA(joint, rng);
  const aOutcome = entangled.aAxis[aMeasurement.outcomeIndex];
  const bCollapse = collapseQubit(aMeasurement.conditionedB, entangled.bAxis, rng);
  const cCollapse = collapseQubit(qubitC, standalone.axis, rng);
  const pCollapse = (peacekeeper && qubitP) ? collapseQubit(qubitP, peacekeeper.axis, rng) : null;

  // Rebuild a clean one-hot joint state from both collapsed outcomes.
  const oneHot = [0, 0, 0, 0];
  oneHot[aMeasurement.outcomeIndex * 2 + bCollapse.outcomeIndex] = 1;
  const collapsedJoint = oneHot.map(v => (v ? { re: 1, im: 0 } : { re: 0, im: 0 }));

  let entangledEffect = null;
  if (aMeasurement.outcomeIndex === 0 && bCollapse.outcomeIndex === 0) {
    entangledEffect = { stability: -2, conflictEvents: +1, label: "entangled escalation" };
  } else if (aMeasurement.outcomeIndex === 1 && bCollapse.outcomeIndex === 1) {
    entangledEffect = { stability: +2, dealIntegrity: +1, label: "entangled de-escalation" };
  }

  // The peacekeeper mechanic: this is deliberately NOT "US collapses to
  // activelyMediate -> good things happen" as a flat bonus. It only ever
  // does anything when there's an entangled escalation to push back
  // against, and it dampens rather than cancels it — a mediator reduces
  // the severity of a crisis it didn't cause, it doesn't erase it. If the
  // pair is de-escalating on their own, or the US has collapsed to
  // disengage, this is a no-op and the raw entangledEffect above stands
  // exactly as it already did before this feature existed.
  let peacekeeperIntervention = null;
  if (
    peacekeeper && pCollapse &&
    pCollapse.outcomeIndex === 0 && // axis[0] = "activelyMediate" by this scenario's convention
    entangledEffect?.label === "entangled escalation"
  ) {
    const original = { ...entangledEffect };
    entangledEffect = {
      stability:      Math.round(entangledEffect.stability      * 0.5),
      conflictEvents: Math.round(entangledEffect.conflictEvents * 0.5),
      label: "entangled escalation (dampened by active US mediation)",
    };
    peacekeeperIntervention = { dampened: true, original };
  }

  return {
    newQuantum: {
      entangledPair: collapsedJoint,
      standaloneQubit: cCollapse.collapsedState,
      ...(peacekeeper && pCollapse ? { peacekeeperQubit: pCollapse.collapsedState } : {}),
    },
    event: {
      [entangled.aId]: aOutcome,
      [entangled.bId]: bCollapse.outcome,
      [standalone.id]: cCollapse.outcome,
      ...(peacekeeper && pCollapse ? { [peacekeeper.id]: pCollapse.outcome } : {}),
      preCollapse,
      entangledEffect,
      peacekeeperIntervention,
    },
  };
}


// ─────────────────────────────────────────────────────────────
// DECISION APPLIER
//
// Takes every nation's agent decision and applies their metricDeltas to
// the simulation state. Also updates agent memory for nation-specific
// state (hormuzStatus, blockadeStatus, etc.) that doesn't live in the
// on-chain metrics. The shared metric deltas + quantum/market plumbing
// below are scenario-agnostic; each nation's own status-flag vocabulary
// and cascade rules are branched by scenario id, same reasoning as
// buildWorldState() above — closing Hormuz and a PLA blockade are not
// the same field wearing a different label, so this doesn't force a
// shared schema onto genuinely different domain content.
//
// Returns { newSimState, newAgentMemory }.
// ─────────────────────────────────────────────────────────────

export function applyDecisions(scenario, simState, decisions, agentMemory = {}, cycle = 0) {
  const s = { ...simState };
  const mem = structuredClone(agentMemory);
  const scenarioId = scenario.meta.id;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, Math.round(v)));

  for (const [nation, result] of Object.entries(decisions)) {
    if (result.error || !result.decision) continue;

    const d = result.decision;
    const deltas = d.metricDeltas || {};

    // Apply shared metric deltas — accumulate across every nation
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

    // Taiwan Strait — same pattern as iran/israel/saudi_arabia above.
    if (nation === "china") {
      mem.china = mem.china || {};
      if (d.blockadeStatus)  mem.china.blockadeStatus  = d.blockadeStatus;
      if (d.invasionStatus)  mem.china.invasionStatus  = d.invasionStatus;
      if (d.coalitionSignal) mem.china.coalitionSignal = d.coalitionSignal;
      if (deltas.hardlinerPressure != null) {
        const current = mem.china.hardlinerPressure ?? 78;
        mem.china.hardlinerPressure = clamp(current + deltas.hardlinerPressure, 0, 100);
      }
    }

    if (nation === "taiwan") {
      mem.taiwan = mem.taiwan || {};
      if (d.coalitionStatus) mem.taiwan.coalitionStatus = d.coalitionStatus;
      if (d.existentialFrameActive != null) mem.taiwan.existentialFrameActive = d.existentialFrameActive;
      if (deltas.publicSentiment != null) {
        const current = mem.taiwan.publicSentiment ?? 66;
        mem.taiwan.publicSentiment = clamp(current + deltas.publicSentiment, 0, 100);
      }
    }

    if (nation === "japan") {
      mem.japan = mem.japan || {};
      if (d.chipExportControlStance)  mem.japan.chipExportControlStance  = d.chipExportControlStance;
      if (d.securityAlignmentStatus)  mem.japan.securityAlignmentStatus  = d.securityAlignmentStatus;
      if (d.coalitionSignal)          mem.japan.coalitionSignal          = d.coalitionSignal;
      if (deltas.reformPressure != null) {
        const current = mem.japan.reformPressure ?? 58;
        mem.japan.reformPressure = clamp(current + deltas.reformPressure, 0, 100);
      }
    }

    // Peacekeeper (Middle East only, for now) — same pattern as the rest.
    if (nation === "us") {
      mem.us = mem.us || {};
      if (d.congressionalRatification) mem.us.congressionalRatification = d.congressionalRatification;
      if (d.coalitionSignal)           mem.us.coalitionSignal           = d.coalitionSignal;
      if (deltas.publicSentiment != null) {
        const current = mem.us.publicSentiment ?? 48;
        mem.us.publicSentiment = clamp(current + deltas.publicSentiment, 0, 100);
      }
      // Drives the peacekeeper's quantum belief-state rotation (see
      // evolveAndCollapseQuantumState() above, which reads
      // metricDeltas.diplomaticCapital directly off this cycle's decision).
      // Without this the qubit never rotates past its first random collapse.
      if (deltas.diplomaticCapital != null) {
        const current = mem.us.diplomaticCapital ?? 65;
        mem.us.diplomaticCapital = clamp(current + deltas.diplomaticCapital, 0, 100);
      }
    }
  }

  // Cascades — scenario-specific escalation logic.
  if (scenarioId === "middle-east-2026") {
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
  }

  if (scenarioId === "taiwan-strait-2026") {
    // Cascade: a full PLA blockade of the strait disrupts trade and
    // stability just as hard as Hormuz closure — arguably harder, given
    // the semiconductor chokepoint, but kept at the same magnitude as the
    // Middle East scenario for cross-scenario comparability.
    if (mem.china?.blockadeStatus === "BLOCKADE") {
      s.trade     = clamp(s.trade     - 40, 0, 500);
      s.stability = clamp(s.stability - 8,  0, 100);
    }
    // Cascade: full invasion ends the status quo outright
    if (mem.china?.invasionStatus === "FULL_INVASION") {
      s.dealIntegrity = 0;
    }
    // Cascade: Taiwan's existential frame active (direct PLA strike, or
    // stability/dealIntegrity crossing the existential threshold) spikes
    // conflict events, mirroring Israel's existentialFrameActive cascade.
    if (mem.taiwan?.existentialFrameActive) {
      s.conflicts = clamp(s.conflicts + 3, 0, 999);
    }
  }

  // Quantum layer: evolve the belief state with this cycle's decisions
  // (unitary), then collapse it (Born-rule measurement — this IS the
  // commit-time "measurement event" the quantum_extension design calls
  // for). Where the entangled pair's collapsed postures land in mutual
  // alignment on axis[0] or axis[1], apply the small additional
  // entanglement effect on top of the classical deltas above. Fully
  // generic — driven by scenario.aiAgents, not by nation id.
  if (!mem.quantum) {
    throw new Error("agentMemory.quantum missing — call initQuantumBeliefs(scenario) when seeding agentMemory");
  }
  const { newQuantum, event } = evolveAndCollapseQuantumState(scenario, mem.quantum, decisions);
  mem.quantum = newQuantum;
  mem.quantum.lastEvent = event;

  if (event.entangledEffect) {
    if (event.entangledEffect.stability      != null) s.stability      += event.entangledEffect.stability;
    if (event.entangledEffect.conflictEvents != null) s.conflicts      += event.entangledEffect.conflictEvents;
    if (event.entangledEffect.dealIntegrity  != null) s.dealIntegrity  += event.entangledEffect.dealIntegrity;
  }

  // Layer 2/3: the economic field evolves from this cycle's geopolitical
  // collapse + classical decisions, then collapses itself; the synthetic
  // trader roster's interference then resolves each instrument's price
  // move (see markets.js). One-directional for now — markets read the
  // political layer, not vice versa. Dispatched by scenarioId since each
  // scenario's instrument set and propagation rules are genuinely
  // different economic content, not a relabeling of the same numbers —
  // see markets.js.
  if (!mem.markets) {
    throw new Error("agentMemory.markets missing — call initMarketBeliefs(scenario) when seeding agentMemory");
  }
  const { newMarketState, event: marketEvent } = evolveAndCollapseMarkets(scenario, mem.markets, event, decisions, cycle);
  mem.markets = newMarketState;
  mem.markets.lastEvent = marketEvent;

  s.market = {
    primary:   (s.market?.primary   ?? 100) + marketEvent.primaryDelta,
    currencyA: (s.market?.currencyA ?? 100) + marketEvent.currencyADelta,
    currencyB: (s.market?.currencyB ?? 100) + marketEvent.currencyBDelta,
    global:    (s.market?.global    ?? 100) + marketEvent.globalDelta,
  };

  s.stability      = clamp(s.stability,     0, 100);
  s.proxy          = clamp(s.proxy,          0, 100);
  s.trade          = clamp(s.trade,          0, 500);
  s.conflicts      = clamp(s.conflicts,      0, 999);
  s.dealIntegrity  = clamp(s.dealIntegrity,  0, 100);
  s.market.primary   = clamp(s.market.primary,   0, 300);
  s.market.currencyA = clamp(s.market.currencyA, 0, 300);
  s.market.currencyB = clamp(s.market.currencyB, 0, 300);
  s.market.global    = clamp(s.market.global,    0, 300);

  return { newSimState: s, newAgentMemory: mem };
}
