/**
 * Shared, scenario-agnostic pieces of running one AI cycle — extracted out
 * of AICycleStep.jsx so the no-wallet "watch it play out" flow
 * (LiveRunPanel.jsx) can drive the exact same decision → quantum collapse
 * → metrics pipeline without duplicating it. AICycleStep.jsx imports these
 * too (pure refactor there — same values, same order, nothing behavioral
 * changed) rather than keeping its own private copies.
 *
 * runAutonomousCycle() is the one thing that's genuinely new: it's
 * AICycleStep's Step 1 (ask agents) and the metrics half of its Step 3
 * (commit), fused into a single call with no pause for a human to review
 * or edit the proposed deltas in between — appropriate for a passive
 * visitor watching a run play out, not for the actual research tool.
 * AICycleStep.jsx does NOT use this function; it keeps its own
 * human-controlled-nation / instinct-veto / researcher-edit branching,
 * none of which applies to an unedited autonomous run.
 */

import { NationAgent, buildWorldState, applyDecisions, createRealEntropyPool } from "./agents.js";

export const CYCLE_COUNT_OPTIONS = [1, 3, 5, 10];

// Metric config ids (shared across every scenario, see simulation.metrics
// in each scenario config) -> the camelCase keys used throughout
// simState/metricDeltas. Only the *display name* varies by scenario
// (e.g. "Deal Integrity" vs. "Status Quo Integrity") — read from the
// scenario's own metric.name, not hardcoded here.
export const METRIC_ID_TO_KEY = {
  stability_index: "stability",
  proxy_activity:  "proxyActivity",
  trade_volume:    "tradeVolume",
  conflict_events: "conflictEvents",
  deal_integrity:  "dealIntegrity",
};

export function buildMetricLabels(scenario) {
  const labels = {};
  for (const m of scenario.simulation.metrics) {
    const key = METRIC_ID_TO_KEY[m.id];
    if (key) labels[key] = m.name;
  }
  return labels;
}

export function buildNationMeta(scenario) {
  return Object.fromEntries(scenario.nations.map(n => [n.id, { label: n.name, flag: n.flag, color: n.color }]));
}

// nationId (as used in decisions/agents) -> key in the worldState object
// built by buildWorldState() — sourced from the scenario's own aiAgents
// config, not hardcoded per scenario.
export function buildWorldStateKeyMap(scenario) {
  const { entangled, standalone, peacekeeper } = scenario.aiAgents;
  const map = {
    [entangled.aId]: entangled.aWorldKey,
    [entangled.bId]: entangled.bWorldKey,
    [standalone.id]: standalone.worldKey,
  };
  if (peacekeeper) map[peacekeeper.id] = peacekeeper.worldKey;
  return map;
}

export function joinWithAnd(items) {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// Decision fields that are NOT scenario-specific status flags — every other
// string field on a decision is rendered generically as a status flag, so
// a new scenario's bespoke vocabulary (blockadeStatus, chipExportControlStance,
// ...) shows up automatically with no frontend changes needed.
export const NON_STATUS_DECISION_KEYS = new Set([
  "primaryAction", "supportingActions", "reasoning", "metricDeltas",
  "coalitionSignal", "coalitionStatus", "researchNote", "existentialFrameActive",
]);

export function humanizeKey(key) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim();
}

// ─────────────────────────────────────────────
// Starting sim state from scenario config
// ─────────────────────────────────────────────
export function initSimState(scenario) {
  const m = scenario.simulation.metrics;
  return {
    stability:    m.find(x => x.id === "stability_index").startingValue,
    conflicts:    m.find(x => x.id === "conflict_events").startingValue,
    trade:        m.find(x => x.id === "trade_volume").startingValue,
    proxy:        m.find(x => x.id === "proxy_activity").startingValue,
    dealIntegrity:m.find(x => x.id === "deal_integrity").startingValue,
    // Layer 2 economic field — index values, 100 = baseline at scenario start.
    market: { primary: 100, currencyA: 100, currencyB: 100, global: 100 },
  };
}

// Map simState field names → METRIC_LABELS keys
export function simStateToMetrics(s) {
  return {
    stability:     s.stability,
    proxyActivity: s.proxy,
    tradeVolume:   s.trade,
    conflictEvents:s.conflicts,
    dealIntegrity: s.dealIntegrity,
  };
}

// Aggregate every nation's metricDeltas into one object
export function aggregateDeltas(decisions) {
  const agg = { stability: 0, proxyActivity: 0, tradeVolume: 0, conflictEvents: 0, dealIntegrity: 0 };
  for (const result of Object.values(decisions)) {
    if (result.error || !result.decision?.metricDeltas) continue;
    for (const [k, v] of Object.entries(result.decision.metricDeltas)) {
      if (k in agg) agg[k] = (agg[k] || 0) + (v || 0);
    }
  }
  return agg;
}

export function deltaColor(v) {
  if (v > 0) return "#22c55e";
  if (v < 0) return "#ef4444";
  return "#666";
}

export function sign(v) { return v > 0 ? `+${v}` : String(v); }

export function clampNum(v, min, max) {
  return Math.min(max, Math.max(min, Math.round(v)));
}

// Same formula AICycleStep's commitCycle() applies to turn "proposed"
// (current + aggregated AI deltas) into the actual on-chain-bound numbers:
// the quantum measurement's entangled effect layers on top of stability/
// conflicts/dealIntegrity (never proxy/trade — those aren't part of the
// entangled pair's axis), then everything is clamped into contract range.
// The economic field (market) has nothing to layer — it's entirely Layer
// 2/3 output — so it's taken straight from newSimState.
export function computeCommittedMetrics(proposed, quantum, newSimState) {
  const entangled = quantum?.entangledEffect || {};
  return {
    stability:     clampNum(proposed.stability     + (entangled.stability      ?? 0), 0, 100),
    proxy:         clampNum(proposed.proxyActivity, 0, 100),
    trade:         clampNum(proposed.tradeVolume,   0, 500),
    conflicts:     clampNum(proposed.conflictEvents + (entangled.conflictEvents ?? 0), 0, 999),
    dealIntegrity: clampNum(proposed.dealIntegrity  + (entangled.dealIntegrity  ?? 0), 0, 100),
    market: {
      primary:   clampNum(newSimState.market.primary,   0, 300),
      currencyA: clampNum(newSimState.market.currencyA, 0, 300),
      currencyB: clampNum(newSimState.market.currencyB, 0, 300),
      global:    clampNum(newSimState.market.global,    0, 300),
    },
  };
}

// ─────────────────────────────────────────────
// On-chain narrative — turning this cycle's decisions/quantum/market
// objects into the plain strings commitCycleWithNarrative() emits as
// event logs (see contracts/core/WorldRegistry.sol). Kept as small pure
// functions here (not inline in LiveRunPanel.jsx) so they're covered by
// the same unit tests as the rest of this file's pipeline, and so
// AICycleStep.jsx's wallet-connected commit flow can reuse them too if
// it ever wants to write narrative on-chain the same way. Field lengths
// are capped client-side as a courtesy (smaller tx, lower gas) — the
// server independently re-caps everything before it ever reaches a
// signer, so a compromised or hand-rolled client can't force an
// oversized transaction; see server.js's own caps on this route.
const CHAIN_FIELD_MAX = 480;

function truncateForChain(s, max = CHAIN_FIELD_MAX) {
  if (typeof s !== "string") return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// One DecisionRecord per nation that actually produced a decision this
// cycle — a nation whose agent call errored has nothing true to record,
// so it's skipped rather than padded with placeholder text.
export function buildDecisionRecords(decisions) {
  return Object.entries(decisions)
    .filter(([, r]) => !r.error && r.decision)
    .map(([nationId, r]) => ({
      nationId,
      primaryAction: truncateForChain(r.decision.primaryAction || ""),
      reasoning: truncateForChain(r.decision.reasoning || ""),
      researchNote: truncateForChain(r.decision.researchNote || ""),
    }));
}

// A readable one-line summary of this cycle's Layer 1 quantum collapse:
// each qubit's collapsed outcome, plus the derived entangled effect
// label (which already names peacekeeper dampening when it applied —
// see agents.js's packageCollapseResult).
export function summarizeQuantum(scenario, quantum) {
  if (!quantum) return "No quantum collapse recorded this cycle.";
  const { entangled, standalone, peacekeeper } = scenario.aiAgents;
  const parts = [];
  for (const id of [entangled.aId, entangled.bId, standalone.id, peacekeeper?.id].filter(Boolean)) {
    if (quantum[id]) parts.push(`${id}: ${quantum[id]}`);
  }
  const effect = quantum.entangledEffect?.label ? ` — ${quantum.entangledEffect.label}` : "";
  return truncateForChain(`${parts.join("; ")}${effect}`);
}

// A readable one-line summary of this cycle's Layer 2/3 market collapse.
export function summarizeMarket(market) {
  if (!market?.outcomes) return "No market movement recorded this cycle.";
  const { outcomes, derivedNote } = market;
  const parts = [
    `primary: ${outcomes.primary}`, `currencyA: ${outcomes.currencyA}`,
    `currencyB: ${outcomes.currencyB}`, `global: ${outcomes.global}`,
  ];
  if (derivedNote) parts.push(`${derivedNote.label}: ${derivedNote.value}`);
  return truncateForChain(parts.join(", "));
}

/**
 * Runs one cycle straight through, no human in the loop: every nation's
 * decision is asked for and applied as-is (Tier 1 real-entropy quantum
 * collapse, classical — never the opt-in real-QPU path, which is slower
 * and higher-stakes than a passive showcase needs), and the result is the
 * actual committed metrics, not a proposal awaiting edits. This is what
 * makes the no-wallet run an honest "unedited AI reasoning" demo rather
 * than a second copy of the researcher tool with the editing UI removed.
 *
 * `decideFn`, when passed, skips NationAgent's own fetch entirely — see
 * agents.js's NationAgent.decide() for what it is and why: this is what
 * lets scripts/run-batch.js drive real batch trials directly from Node,
 * through this exact same function, with no live HTTP server needed.
 */
export async function runAutonomousCycle(scenario, simState, cycle, agentMemory, decideFn) {
  const worldState = buildWorldState(scenario, simState, cycle, agentMemory);
  const decisions = await NationAgent.runAll(scenario, worldState, decideFn);

  const metricLabels = buildMetricLabels(scenario);
  const currentMetrics = simStateToMetrics(simState);
  const agg = aggregateDeltas(decisions);
  const proposed = {};
  for (const k of Object.keys(metricLabels)) {
    proposed[k] = (currentMetrics[k] ?? 0) + (agg[k] || 0);
  }

  const { rng, sourcesUsed } = await createRealEntropyPool();
  const { newSimState, newAgentMemory } = applyDecisions(scenario, simState, decisions, agentMemory, cycle, rng, null);
  const quantum = newAgentMemory.quantum.lastEvent;
  const market  = newAgentMemory.markets.lastEvent;

  const committed = computeCommittedMetrics(proposed, quantum, newSimState);

  return { worldState, decisions, committed, quantum, market, sourcesUsed, newAgentMemory };
}
