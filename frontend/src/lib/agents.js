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
import { quantumRandomFloat } from "./quantumRng.js";
// instinct.js is dynamically imported inside proposeInstinctReadings() below,
// not statically here — it pulls in the quantum-circuit package (and its
// mathjs dependency), which nearly doubled this app's main bundle
// (1.2MB -> 2.3MB minified) when this was a top-level import, since agents.js
// is core plumbing every page loads regardless of whether the current
// scenario even has a veto-capable nation. A dynamic import lets Vite split
// it into its own chunk, fetched only when proposeInstinctReadings() actually
// runs (and skipped entirely when vetoCapableNations() is empty).

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
// INSTINCT LAYER — bridges this file's own quantum roles to
// instinct.js's proposeVetoInstinct(). See instinct.js's module doc for
// what this reading is and is not. This file's only job here is
// resolving WHICH pressure field and WHICH entangled partner (if any)
// belong to a given veto-capable nation — generically, from the exact
// same aiAgents role assignments buildWorldState() above already reads,
// not a second hardcoded mapping.
// ─────────────────────────────────────────────────────────────

// Nations whose Solidity governance config actually has a veto lever
// (guardianVeto or royalVeto) — the only nations an instinct reading
// means anything for. Purely a config read, no quantum state needed.
export function vetoCapableNations(scenario) {
  return scenario.nations.filter(n => n.governance?.guardianVeto || n.governance?.royalVeto);
}

// Resolve {pressureField, pressureValue, entangledWith} for one
// veto-capable nation from scenario.aiAgents' entangled/standalone/
// peacekeeper roles — the same roles, the same live worldState keys,
// buildWorldState() already uses. pressureValue is read live off
// worldState (this cycle's tracked running value, same as
// aState.hardlinerPressure/cState.reformPressure above), falling back to
// the scenario config's starting value on cycle 1 before anything's been
// tracked yet. A veto-capable nation that isn't assigned any of these
// four roles has nothing to build a reading from — returns null, not a
// guess. (Not yet exercised for the B-side/peacekeeper branches by any
// real scenario — Israel, Taiwan, and the US peacekeeper all currently
// have guardianVeto: false, royalVeto: false — but wired the same
// generic way as the other two roles rather than special-cased away,
// consistent with this file's existing standard.)
export function resolveInstinctInputs(scenario, worldState, quantum, nationId) {
  const { entangled, standalone, peacekeeper } = scenario.aiAgents;
  const nations = nationsById(scenario);
  const liveValue = (worldKey, field) => worldState[worldKey]?.[field] ?? nations[nationId].governance?.[field] ?? 50;

  if (nationId === entangled.aId) {
    return {
      pressureField: entangled.aDriverField,
      pressureValue: liveValue(entangled.aWorldKey, entangled.aDriverField),
      entangledWith: {
        nationId: entangled.bId,
        name: nations[entangled.bId].name,
        axis0Probability: marginalB(quantum.entangledPair)[0],
      },
    };
  }
  if (nationId === entangled.bId) {
    return {
      pressureField: entangled.bDriverField,
      pressureValue: liveValue(entangled.bWorldKey, entangled.bDriverField),
      entangledWith: {
        nationId: entangled.aId,
        name: nations[entangled.aId].name,
        axis0Probability: marginalA(quantum.entangledPair)[0],
      },
    };
  }
  if (nationId === standalone.id) {
    return {
      pressureField: standalone.driverField,
      pressureValue: liveValue(standalone.worldKey, standalone.driverField),
      entangledWith: null,
    };
  }
  if (peacekeeper && nationId === peacekeeper.id) {
    return {
      pressureField: peacekeeper.driverField,
      pressureValue: liveValue(peacekeeper.worldKey, peacekeeper.driverField),
      entangledWith: null,
    };
  }
  return null;
}

// One proposed instinct reading per veto-capable nation this scenario
// has, keyed by nationId. Does NOT call guardianVeto()/royalVeto() (see
// instinct.js) and does NOT feed back into simState/decisions anywhere —
// purely an additional human-reviewable readout, same review-before-
// on-chain boundary as everything else in this pipeline. A nation
// resolveInstinctInputs can't place is skipped, not defaulted.
//
// rng: optional, forwarded to proposeVetoInstinct() for each nation —
// omit it to get the real default (quantumRandomFloat, ANU QRNG with
// PRNG fallback); pass one to force a specific entropy source (tests,
// or a future "prefer speed over real entropy" mode).
export async function proposeInstinctReadings(scenario, worldState, quantum, rng) {
  const capable = vetoCapableNations(scenario);
  if (capable.length === 0) return {}; // no veto-capable nation — skip the instinct.js chunk fetch entirely

  const { proposeVetoInstinct } = await import("./instinct.js");

  const readings = await Promise.all(
    capable.map(async (nation) => {
      const inputs = resolveInstinctInputs(scenario, worldState, quantum, nation.id);
      if (!inputs) return null;
      const reading = await proposeVetoInstinct({
        nation: { id: nation.id, name: nation.name },
        pressureField: inputs.pressureField,
        pressureValue: inputs.pressureValue,
        ...(rng ? { rng } : {}),
        entangledWith: inputs.entangledWith,
      });
      return [nation.id, { ...reading, vetoType: nation.governance.guardianVeto ? "guardian" : "royal" }];
    })
  );
  return Object.fromEntries(readings.filter(Boolean));
}

function qpuNote(nationName, body, entangledWithName) {
  const source = body.simulator
    ? `a local simulator fallback (${body.detail ?? "reason not recorded"})`
    : `real IBM quantum hardware (${body.backend}, job ${body.job_id})`;
  const tail = entangledWithName ? `, entangled with ${entangledWithName}'s live posture` : ", read standalone";
  return `${nationName}'s instinct measured ${body.outcome}${tail} — via ${source}.`;
}

// Tier 2 — the same veto-capable-nation resolution as
// proposeInstinctReadings() above, but posts to /api/instinct/qpu-reading
// (server.js's proxy to python-bridge/app.py — see that project's own
// README for current verified-live status) instead of running
// instinct.js's circuit locally. python-bridge runs the SAME circuit on
// real IBM hardware when a token is configured server-side, or its own
// local Aer simulator fallback otherwise.
//
// A QPU reading has no "pre-collapse probability" to preview — a
// measurement gate is always included server-side, so what comes back is
// an already-resolved single real outcome, not odds. AICycleStep.jsx
// renders these (tier: "qpu") through QpuInstinctBadge, not
// InstinctBar's probability bar, for exactly this reason.
//
// Opt-in only — AICycleStep.jsx gates this behind an explicit toggle,
// default OFF: each real reading takes ~10-15s and spends real IBM
// Quantum quota once a token is configured, unlike Tier 1's near-instant
// readings. On any failure (endpoint unreachable, python-bridge down,
// non-2xx response), falls back to a Tier 1 local reading — tagged
// tier: "tier1-fallback" with the actual qpuError recorded — rather than
// leaving a nation with no reading at all.
export async function proposeInstinctReadingsViaQPU(scenario, worldState, quantum, fetchImpl = fetch) {
  const capable = vetoCapableNations(scenario);
  if (capable.length === 0) return {};

  const readings = await Promise.all(
    capable.map(async (nation) => {
      const inputs = resolveInstinctInputs(scenario, worldState, quantum, nation.id);
      if (!inputs) return null;
      const vetoType = nation.governance.guardianVeto ? "guardian" : "royal";

      try {
        const res = await fetchImpl("/api/instinct/qpu-reading", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pressure: inputs.pressureValue,
            entangledReadout: inputs.entangledWith?.axis0Probability ?? undefined,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.statusText);

        return [nation.id, {
          nationId: nation.id,
          vetoType,
          tier: "qpu",
          outcome: body.outcome,
          outcomeIndex: body.outcome_bit,
          backend: body.backend,
          jobId: body.job_id,
          simulator: body.simulator,
          detail: body.detail,
          note: qpuNote(nation.name, body, inputs.entangledWith?.name),
        }];
      } catch (err) {
        const { proposeVetoInstinct } = await import("./instinct.js");
        const fallback = await proposeVetoInstinct({
          nation: { id: nation.id, name: nation.name },
          pressureField: inputs.pressureField,
          pressureValue: inputs.pressureValue,
          entangledWith: inputs.entangledWith,
        });
        return [nation.id, { ...fallback, vetoType, tier: "tier1-fallback", qpuError: err.message }];
      }
    })
  );
  return Object.fromEntries(readings.filter(Boolean));
}

// ─────────────────────────────────────────────────────────────
// REAL ENTROPY FOR THE MAIN QUANTUM COLLAPSE (Layer 1/2/3)
//
// evolveAndCollapseQuantumState()/evolveAndCollapseMarkets() (and the
// quantum.js primitives underneath — collapseQubit/measureA/measureQubit)
// all default their rng to Math.random, UNCHANGED — that default matters
// and stays as-is. scripts/quantum-vs-classical-test.mjs calls this same
// machinery thousands of times per validation run; forcing real network
// entropy into that shared default would make those runs catastrophically
// slow and would spam ANU's public API well past reasonable use. This
// real-entropy path is opt-in, explicit, and meant for exactly one place:
// AICycleStep.jsx's commitCycle(), the live interactive commit a human is
// actually watching happen — same "real entropy where a human is present
// to see it, not in a hot statistical loop" boundary instinct.js's Tier 1
// already draws.
//
// collapseQubit/measureA/measureQubit call rng() synchronously, inline,
// mid-computation — they can't await a real network call without making
// quantum.js's core primitives async, which would slow the validation
// script too even when it injects its own fast rng, for zero benefit
// there. Instead: pre-fetch a small pool of real entropy values (parallel
// real network round-trips via quantumRandomFloat) BEFORE the synchronous
// collapse chain runs, then hand out a plain synchronous rng that pops
// from that pool.
//
// The actual draw count, VERIFIED against a real live run rather than
// assumed (an earlier version of this comment claimed "at most 8" —
// wrong, caught by an actual live run pulling only 1/20 real values and
// exhausting a pool of 10): Layer 1's political collapse draws 4
// (measureA + up to 3x collapseQubit, Middle East's peacekeeper included;
// Taiwan Strait has no peacekeeper, so 3). Layer 2/3's market collapse
// draws 4 (measureQubit x4, one per instrument) PLUS 12 more —
// resolvePriceMove() in markets.js samples each instrument's price-move
// magnitude from a Gaussian/Cauchy mixture (gaussianRandom: 2 draws,
// cauchyRandom: 1 draw = 3 per instrument x 4 instruments), easy to miss
// by reading evolveAndCollapseMarkets() alone since that sampling is
// nested inside resolvePriceMove(), not visible at the top level. Total:
// 20 for Middle East, 19 for Taiwan Strait. Default pool size below has
// real headroom above that, not a guess.
export async function createRealEntropyPool(size = 24, drawFn = quantumRandomFloat) {
  const draws = await Promise.all(Array.from({ length: size }, () => drawFn()));
  let i = 0;
  const sourcesUsed = [];
  const rng = () => {
    if (i < draws.length) {
      const { value, source } = draws[i++];
      sourcesUsed.push(source);
      return value;
    }
    sourcesUsed.push("math-random-fallback-pool-exhausted");
    return Math.random();
  };
  return { rng, sourcesUsed };
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


// ─────────────────────────────────────────────────────────────
// LAYER 2/3 -> LAYER 1 RETROGRADE FEEDBACK (mechanistic, per-scenario)
//
// Markets (Layer 2) and speculation (Layer 3) have, until now, only ever
// been downstream of the political layer — see markets.js's file header.
// This closes the loop for the one cycle boundary where causality is
// actually clean: the PRIOR cycle's already-collapsed market event (an
// immutable fact by the time this cycle starts) is applied as unitary
// rotations to the political qubits, BEFORE this cycle's own decisions are
// folded in below. That ordering matters — feeding back a market result
// that hasn't resolved yet within the same cycle would be a causality
// loop, not a feedback loop.
//
// Middle East only for now (Taiwan Strait has no propagator here — same
// "absent = no-op, not an error" precedent already used for the optional
// peacekeeper qubit). Each mechanism below is a specific, motivated
// econ-to-politics story, not a generic "markets moved, therefore
// politics moves" formula — matching this file's existing standard for
// L1->L2 propagation in markets.js:
//
//   - Rial WEAKENING -> Iran's qubit hardens (economic hardship strengthens
//     the domestic hardliner argument — the same causal story already
//     encoded by the hardlinerPressure driver, just triggered by markets
//     instead of this cycle's LLM decision).
//   - Riyal ROBUST (the windfall branch) -> Saudi's qubit eases toward
//     "cautious" (an oil windfall reduces the domestic urgency Vision 2030
//     reform is meant to answer).
//   - Gas SURGING -> the US peacekeeper qubit drifts toward "disengage"
//     (pump-price pain is a real audience cost against continued
//     diplomatic investment in the deal).
//
// Layer 3 (not just Layer 2's collapsed direction) genuinely participates:
// each rotation's magnitude is amplified by that instrument's speculative
// tailWeight (see markets.js's resolvePriceMove) — a fat-tailed, panic-
// driven move rattles domestic politics harder than a routine drift of the
// same average size, which is the actual falsifiable content of routing
// this through Layer 3 rather than reading Layer 2's direction directly.
function retrogradeMiddleEast(quantum, marketEvent, cycle) {
  let joint  = quantum.entangledPair;
  let qubitC = quantum.standaloneQubit;
  let qubitP = quantum.peacekeeperQubit;
  const applied = [];

  const outcomes     = marketEvent.outcomes || {};
  const speculation  = marketEvent.speculation || {};
  const ampFactor = (move) => 1 + (move?.tailWeight ?? 0); // 1x (calm) to ~2x (fat-tailed panic)

  if (outcomes.currencyA === "WEAKENING") {
    const amp = ampFactor(speculation.currencyA);
    const theta = -(Math.PI / 16) * amp; // toward axis[0] ("hardline")
    joint = applyLocalRotation(joint, "A", theta, actionPhase(`retro-rial:${cycle}`));
    applied.push({ driver: "rial_weakening", target: "iran", theta, amplifiedBy: amp });
  }

  if (outcomes.currencyB === "ROBUST") {
    const amp = ampFactor(speculation.currencyB);
    const theta = (Math.PI / 20) * amp; // toward axis[1] ("cautious")
    qubitC = rotate(qubitC, theta, actionPhase(`retro-riyal:${cycle}`));
    applied.push({ driver: "riyal_windfall", target: "saudi_arabia", theta, amplifiedBy: amp });
  }

  if (qubitP && outcomes.global === "SURGING") {
    const amp = ampFactor(speculation.global);
    const theta = (Math.PI / 20) * amp; // toward axis[1] ("disengage")
    qubitP = rotate(qubitP, theta, actionPhase(`retro-gas:${cycle}`));
    applied.push({ driver: "gas_surge", target: "us", theta, amplifiedBy: amp });
  }

  return { entangledPair: joint, standaloneQubit: qubitC, peacekeeperQubit: qubitP, applied };
}

const RETROGRADE_PROPAGATORS = {
  "middle-east-2026": retrogradeMiddleEast,
};

// marketEvent: the PRIOR cycle's evolveAndCollapseMarkets() event (i.e.
// agentMemory.markets.lastEvent as it stands BEFORE this cycle's own
// markets evolution runs), or null/undefined on cycle 1 before any market
// has ever resolved. Scenario without a registered propagator, or no prior
// event yet: no-op, quantum passes through unchanged.
function applyEconomicFeedback(scenario, quantum, marketEvent, cycle) {
  const propagate = RETROGRADE_PROPAGATORS[scenario.meta.id];
  if (!propagate || !marketEvent) {
    return {
      entangledPair: quantum.entangledPair,
      standaloneQubit: quantum.standaloneQubit,
      peacekeeperQubit: quantum.peacekeeperQubit,
      applied: [],
    };
  }
  return propagate(quantum, marketEvent, cycle);
}

// Pure unitary evolution — no rng, no collapse, no side effects. Shared
// by every collapse strategy below (classical Math.random, classical
// real-entropy, and Tier 2's real-hardware state preparation) so the
// actual evolution logic (retrograde feedback, per-nation order-
// dependent rotations) exists exactly once and can never drift between
// them. Split out of what was a single evolveAndCollapseQuantumState()
// when Tier 2 needed to intercept the joint state AFTER evolution but
// BEFORE any collapse strategy touches it.
function evolveQuantumState(scenario, quantum, decisions, marketEvent, cycle) {
  const { entangled, standalone, peacekeeper } = scenario.aiAgents;
  const feedback = applyEconomicFeedback(scenario, quantum, marketEvent, cycle);
  let joint  = feedback.entangledPair;
  let qubitC = feedback.standaloneQubit;
  let qubitP = feedback.peacekeeperQubit; // may be undefined if this scenario has no peacekeeper

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

  return {
    joint, qubitC, qubitP, preCollapse,
    retrogradeFeedback: feedback.applied.length ? feedback.applied : null,
  };
}

// Shared "package the outcome" step — takes whichever collapse strategy
// already decided (aOutcomeIndex, bOutcomeIndex, cCollapse, pCollapse)
// and builds the same {newQuantum, event} shape every caller returns.
// `extra` carries collapse-strategy-specific provenance (e.g. Tier 2's
// collapseSource/backend/jobId) into the event record — every strategy
// must say honestly which one it was, never silently uniform.
function packageCollapseResult(scenario, evolved, aOutcomeIndex, bOutcomeIndex, cCollapse, pCollapse, extra = {}) {
  const { entangled, standalone, peacekeeper } = scenario.aiAgents;
  const aOutcome = entangled.aAxis[aOutcomeIndex];
  const bOutcome = entangled.bAxis[bOutcomeIndex];

  // Rebuild a clean one-hot joint state from both collapsed outcomes.
  // Index = aOutcomeIndex*2 + bOutcomeIndex — this exact weighting (A the
  // more-significant bit) is the convention layer1_qpu.py's state-prep
  // circuit is built against too (qubit 1 = A, qubit 0 = B); changing it
  // here without changing it there would silently swap which side's
  // outcome Tier 2 reports.
  const oneHot = [0, 0, 0, 0];
  oneHot[aOutcomeIndex * 2 + bOutcomeIndex] = 1;
  const collapsedJoint = oneHot.map(v => (v ? { re: 1, im: 0 } : { re: 0, im: 0 }));

  let entangledEffect = null;
  if (aOutcomeIndex === 0 && bOutcomeIndex === 0) {
    entangledEffect = { stability: -2, conflictEvents: +1, label: "entangled escalation" };
  } else if (aOutcomeIndex === 1 && bOutcomeIndex === 1) {
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
      [entangled.bId]: bOutcome,
      [standalone.id]: cCollapse.outcome,
      ...(peacekeeper && pCollapse ? { [peacekeeper.id]: pCollapse.outcome } : {}),
      preCollapse: evolved.preCollapse,
      entangledEffect,
      peacekeeperIntervention,
      // Layer 2/3 -> Layer 1 retrograde feedback actually applied THIS
      // cycle (sourced from last cycle's market event) — null when there
      // was nothing to feed back (cycle 1, or no propagator registered
      // for this scenario). Part of the citable research record, same as
      // entangledEffect/peacekeeperIntervention above.
      retrogradeFeedback: evolved.retrogradeFeedback,
      ...extra,
    },
  };
}

// The classical collapse strategy — same behavior as this project has
// always had (real-entropy-sourced since the previous PR, still opt-in
// via rng), now expressed as evolve (shared) + classical measureA/
// collapseQubit + package (shared). collapseSource: "classical" makes
// every event record say which strategy produced it, matching Tier 2's
// own honesty requirement below rather than leaving it implicit.
export function evolveAndCollapseQuantumState(scenario, quantum, decisions, marketEvent = null, cycle = 0, rng = Math.random) {
  const { entangled, standalone, peacekeeper } = scenario.aiAgents;
  const evolved = evolveQuantumState(scenario, quantum, decisions, marketEvent, cycle);

  const aMeasurement = measureA(evolved.joint, rng);
  const bCollapse = collapseQubit(aMeasurement.conditionedB, entangled.bAxis, rng);
  const cCollapse = collapseQubit(evolved.qubitC, standalone.axis, rng);
  const pCollapse = (peacekeeper && evolved.qubitP) ? collapseQubit(evolved.qubitP, peacekeeper.axis, rng) : null;

  return packageCollapseResult(scenario, evolved, aMeasurement.outcomeIndex, bCollapse.outcomeIndex, cCollapse, pCollapse, {
    collapseSource: "classical",
  });
}

// Tier 2 for Layer 1 — the actual entangled pair (A/B), not the whole
// register. Standalone (C) and peacekeeper (P) qubits stay classical
// here on purpose: a single unentangled qubit's collapse doesn't carry
// an entanglement claim to make more physically real, Tier 1's real-
// entropy sampling (see createRealEntropyPool) already is the honest,
// real version of that. What's actually new here is the joint A/B state
// — the one place this project claims genuine quantum entanglement —
// getting prepared and measured on a real IBM QPU instead of being
// classically sampled via measureA()+collapseQubit(). See python-bridge/
// layer1_qpu.py for the state-prep circuit and its own status.
//
// STAKES ARE HIGHER THAN instinct.js's Tier 2: that one is a side-
// channel display, never fed into simState. THIS collapse IS what
// evolveAndCollapseQuantumState would have produced instead — it feeds
// entangledEffect, which feeds the on-chain committed stability/conflict
// deltas. On any failure it falls back to the SAME classical procedure
// evolveAndCollapseQuantumState uses (not a degraded stand-in), and every
// event carries collapseSource so the citable record says plainly which
// one actually happened this cycle — never uniform, never silent.
export async function evolveAndCollapseQuantumStateViaQPU(scenario, quantum, decisions, marketEvent = null, cycle = 0, fetchImpl = fetch) {
  const { entangled, standalone, peacekeeper } = scenario.aiAgents;
  const evolved = evolveQuantumState(scenario, quantum, decisions, marketEvent, cycle);

  const cCollapse = collapseQubit(evolved.qubitC, standalone.axis, Math.random);
  const pCollapse = (peacekeeper && evolved.qubitP) ? collapseQubit(evolved.qubitP, peacekeeper.axis, Math.random) : null;

  let aOutcomeIndex, bOutcomeIndex, extra;
  try {
    const res = await fetchImpl("/api/layer1/qpu-collapse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joint: evolved.joint }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    aOutcomeIndex = body.a_outcome;
    bOutcomeIndex = body.b_outcome;
    extra = {
      collapseSource: body.simulator ? "qpu-fallback-simulator" : "qpu-real-hardware",
      backend: body.backend,
      jobId: body.job_id,
      ...(body.detail ? { qpuDetail: body.detail } : {}),
    };
  } catch (err) {
    // Real hardware genuinely unreachable — fall back to the identical
    // classical procedure evolveAndCollapseQuantumState uses, not a
    // weaker stand-in, since this collapse feeds the actual committed
    // outcome. collapseSource says plainly this cycle didn't get the
    // real-hardware treatment it asked for.
    const aMeasurement = measureA(evolved.joint, Math.random);
    const bCollapse = collapseQubit(aMeasurement.conditionedB, entangled.bAxis, Math.random);
    aOutcomeIndex = aMeasurement.outcomeIndex;
    bOutcomeIndex = bCollapse.outcomeIndex;
    extra = { collapseSource: "classical-fallback", qpuError: err.message };
  }

  return packageCollapseResult(scenario, evolved, aOutcomeIndex, bOutcomeIndex, cCollapse, pCollapse, extra);
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
//
// rng: optional. Left undefined, this is byte-for-byte the same as
// before — every collapse call below falls through to quantum.js's own
// Math.random default, which matters: scripts/quantum-vs-classical-test.mjs
// calls this same function thousands of times per run, and forcing real
// network entropy into that shared default would make validation runs
// catastrophically slow and spam ANU's public API. Pass a real rng (see
// createRealEntropyPool below) only at the one call site that actually
// wants it — the live interactive commit a human is watching happen.
//
// precomputedPoliticalCollapse: optional. Left null, the political
// collapse happens internally via evolveAndCollapseQuantumState (the
// classical strategy), exactly as before this param existed. Pass the
// {newQuantum, event} result of evolveAndCollapseQuantumStateViaQPU
// (Tier 2, real IBM hardware) to use that instead — computed by the
// caller BEFORE calling this function, since that path is async (a real
// network call) and applyDecisions itself stays synchronous, same
// resolve-before-the-sync-chain-runs pattern createRealEntropyPool
// already uses for Tier 1.
// ─────────────────────────────────────────────────────────────

export function applyDecisions(scenario, simState, decisions, agentMemory = {}, cycle = 0, rng = undefined, precomputedPoliticalCollapse = null) {
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
  //
  // Before folding in this cycle's own decisions, evolveAndCollapseQuantumState
  // first applies LAST cycle's already-collapsed market event (Layer 2/3)
  // back onto the political qubits (see retrogradeMiddleEast() above) —
  // captured here, before mem.markets gets overwritten by this cycle's own
  // markets evolution below.
  if (!mem.quantum) {
    throw new Error("agentMemory.quantum missing — call initQuantumBeliefs(scenario) when seeding agentMemory");
  }
  const priorMarketEvent = mem.markets?.lastEvent ?? null;
  const { newQuantum, event } = precomputedPoliticalCollapse
    ?? evolveAndCollapseQuantumState(scenario, mem.quantum, decisions, priorMarketEvent, cycle, rng);
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
  // move (see markets.js). Markets still only ever read THIS cycle's
  // political layer, not vice versa — the retrograde path above is the
  // other half of the loop, and it always reads one cycle in arrears (last
  // cycle's collapse informing this cycle's politics), never this cycle's
  // own not-yet-resolved market event. Dispatched by scenarioId since each
  // scenario's instrument set and propagation rules are genuinely
  // different economic content, not a relabeling of the same numbers —
  // see markets.js.
  if (!mem.markets) {
    throw new Error("agentMemory.markets missing — call initMarketBeliefs(scenario) when seeding agentMemory");
  }
  const { newMarketState, event: marketEvent } = evolveAndCollapseMarkets(scenario, mem.markets, event, decisions, cycle, rng);
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
