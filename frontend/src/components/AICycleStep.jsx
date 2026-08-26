import { useState, useCallback } from "react";
import { NationAgent, buildWorldState, applyDecisions, initQuantumBeliefs, initMarketBeliefs, proposeInstinctReadings, proposeInstinctReadingsViaQPU, createRealEntropyPool, evolveAndCollapseQuantumStateViaQPU } from "../lib/agents";
import { stabilityLabel, stabilityColor } from "../lib/simulation";
import { nationActionMenu } from "../lib/nationActions";
import {
  CYCLE_COUNT_OPTIONS, buildMetricLabels, buildNationMeta, buildWorldStateKeyMap,
  joinWithAnd, NON_STATUS_DECISION_KEYS, humanizeKey, initSimState, simStateToMetrics,
  aggregateDeltas, deltaColor, sign, computeCommittedMetrics,
} from "../lib/cycleRunner";

const DEFAULT_MAX_CYCLES = 10;


// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

// Two-outcome probability bar for a pre-collapse quantum belief state.
// `belief` = { [labelA]: probA, [labelB]: probB }
function QuantumBeliefBar({ belief }) {
  if (!belief) return null;
  const [[labelA, probA], [labelB]] = Object.entries(belief);
  const pctA = Math.round(probA * 100);
  return (
    <div className="quantum-belief">
      <div className="quantum-belief-header">
        <span>⚛ superposition</span>
        <span className="quantum-belief-labels">{labelA.toUpperCase()} {pctA}% · {labelB.toUpperCase()} {100 - pctA}%</span>
      </div>
      <div className="quantum-belief-track">
        <div className="quantum-belief-fill" style={{ width: `${pctA}%` }} />
      </div>
    </div>
  );
}

// Pre-deliberative guardian/royal veto instinct — see lib/instinct.js.
// Distinct visual treatment from QuantumBeliefBar on purpose (amber, not
// indigo): this is upstream of the reasoned belief state above it, not
// another view onto the same thing. entropySource distinguishes a real
// ANU QRNG-sourced reading from the honestly-labeled PRNG fallback —
// never shown as if it were the real thing when it isn't.
function InstinctBar({ reading }) {
  if (!reading) return null;
  const allowPct = Math.round(reading.probabilities.ALLOW * 100);
  const isReal = reading.entropySource === "anu-qrng";
  return (
    <div className="quantum-belief instinct-belief">
      <div className="quantum-belief-header">
        <span>{reading.vetoType === "guardian" ? "🕯 guardian instinct" : "👑 royal instinct"}</span>
        <span className="quantum-belief-labels">VETO {100 - allowPct}% · ALLOW {allowPct}%</span>
      </div>
      <div className="quantum-belief-track">
        <div className="quantum-belief-fill instinct-belief-fill" style={{ width: `${allowPct}%` }} />
      </div>
      <div className={`instinct-entropy ${isReal ? "instinct-entropy--real" : "instinct-entropy--fallback"}`}>
        {isReal ? "⚛ real quantum entropy (ANU QRNG)" : `≈ PRNG fallback — ${reading.entropyDetail ?? "reason not recorded"}`}
      </div>
      {reading.tier === "tier1-fallback" && (
        <div className="instinct-entropy instinct-entropy--fallback">
          ⚠ real IBM hardware was requested but unreachable — {reading.qpuError}
        </div>
      )}
    </div>
  );
}

// Tier 2 — a real (or, on failure, honestly-labeled fallback) IBM
// hardware measurement, see lib/agents.js's proposeInstinctReadingsViaQPU.
// Deliberately NOT a probability bar like InstinctBar: a QPU reading has
// already collapsed by the time it comes back (python-bridge always
// includes a measurement gate) — there's no pre-collapse odds to preview,
// so showing one would misrepresent an already-resolved real measurement
// as a live-updating forecast.
function QpuInstinctBadge({ reading }) {
  if (!reading || reading.tier !== "qpu") return null;
  const isReal = !reading.simulator;
  return (
    <div className="quantum-belief instinct-belief qpu-belief">
      <div className="quantum-belief-header">
        <span>{reading.vetoType === "guardian" ? "🕯 guardian instinct" : "👑 royal instinct"} · measured</span>
        <span className="quantum-belief-labels">{reading.outcome}</span>
      </div>
      <div className={`instinct-entropy ${isReal ? "instinct-entropy--real" : "instinct-entropy--fallback"}`}>
        {isReal
          ? `⚛ real IBM quantum hardware — ${reading.backend}, job ${reading.jobId}`
          : `≈ local simulator fallback — ${reading.detail ?? "reason not recorded"}`}
      </div>
    </div>
  );
}

function NationCard({ nationId, result, quantumBeliefState, instinctReading, nationMeta, metricLabels }) {
  const meta = nationMeta[nationId];
  const d    = result?.decision;

  if (result?.error) {
    return (
      <div className="nation-card nation-card--error">
        <div className="nation-card-header">
          <span>{meta.flag}</span>
          <span>{meta.label}</span>
        </div>
        <div className="error-box" style={{ marginTop: "0.75rem" }}>{result.error}</div>
      </div>
    );
  }

  if (!d) return null;

  const deltas = d.metricDeltas || {};
  const statusFlags = Object.entries(d).filter(([k, v]) => !NON_STATUS_DECISION_KEYS.has(k) && typeof v === "string");

  return (
    <div className="nation-card" style={{ "--nation-color": meta.color }}>
      <div className="nation-card-header">
        <span className="nation-flag">{meta.flag}</span>
        <span className="nation-name">{meta.label}</span>
        {d.source === "human" && <span className="source-badge">HUMAN</span>}
        <span className="nation-coalition" style={{ color: meta.color }}>
          {d.coalitionSignal || d.coalitionStatus || "—"}
        </span>
      </div>

      <QuantumBeliefBar belief={quantumBeliefState} />
      {instinctReading?.tier === "qpu"
        ? <QpuInstinctBadge reading={instinctReading} />
        : <InstinctBar reading={instinctReading} />}

      <div className="nation-action">
        <span className="action-primary">{d.primaryAction}</span>
        {d.supportingActions?.length > 0 && (
          <span className="action-supporting">
            + {d.supportingActions.join(", ")}
          </span>
        )}
      </div>

      <div className="nation-reasoning">{d.reasoning}</div>

      <div className="nation-deltas">
        {Object.entries(deltas)
          .filter(([k]) => k in metricLabels)
          .map(([k, v]) => (
            <div key={k} className="delta-row">
              <span className="delta-label">{metricLabels[k]}</span>
              <span className="delta-val" style={{ color: deltaColor(v) }}>{sign(v)}</span>
            </div>
          ))}
      </div>

      {/* Nation-specific status flags — rendered generically from whatever
          string fields the decision carries beyond the known shared ones */}
      <div className="nation-status-flags">
        {statusFlags.map(([k, v]) => (
          <span key={k} className="status-flag">{humanizeKey(k)}: {v}</span>
        ))}
        {d.existentialFrameActive && <span className="status-flag status-flag--alert">EXISTENTIAL FRAME</span>}
      </div>

      <div className="nation-research-note muted">{d.researchNote}</div>
    </div>
  );
}

// Human-in-the-loop decision form — lets a real person take a nation's turn
// instead of the AI agent, using the exact same decision schema (primaryAction
// from the same categorized menu the AI's own prompt offers, metricDeltas
// clamped to the same bounds, a required reasoning field) so the result
// plugs into applyDecisions()/the quantum cascade/on-chain commit with zero
// downstream changes. See lib/nationActions.js for where the menu data
// comes from and its one real caveat (hand-kept in sync with server.js).
function HumanDecisionForm({ nationId, scenarioId, nationMeta, metricLabels, draft, onChange }) {
  const meta = nationMeta[nationId];
  const menu = nationActionMenu(scenarioId, nationId);

  if (!menu) {
    return (
      <div className="human-form human-form--unavailable">
        <span className="muted">Human mode isn't set up for {meta.label} in this scenario yet.</span>
      </div>
    );
  }

  const d = draft || { primaryAction: "", reasoning: "", metricDeltas: {} };

  function setAction(action) {
    onChange(nationId, { ...d, primaryAction: action });
  }
  function setReasoning(reasoning) {
    onChange(nationId, { ...d, reasoning });
  }
  function setDelta(key, value) {
    onChange(nationId, { ...d, metricDeltas: { ...d.metricDeltas, [key]: value } });
  }

  return (
    <div className="human-form">
      <div className="human-form-section">
        <span className="human-form-label">Choose {meta.label}'s move</span>
        {Object.entries(menu.categories).map(([category, actions]) => (
          <div key={category} className="action-category">
            <span className="action-category-label">{category}</span>
            <div className="action-chip-row">
              {actions.map(action => (
                <button
                  key={action}
                  type="button"
                  className={`action-chip ${d.primaryAction === action ? "action-chip--selected" : ""}`}
                  style={d.primaryAction === action ? { borderColor: meta.color, color: meta.color } : undefined}
                  onClick={() => setAction(action)}
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="human-form-section">
        <span className="human-form-label">Expected metric effects</span>
        <div className="human-form-deltas">
          {Object.entries(menu.metricBounds).map(([key, [min, max]]) => (
            <div key={key} className="human-delta-row">
              <span className="delta-label">{metricLabels[key] || humanizeKey(key)}</span>
              <input
                type="number"
                min={min}
                max={max}
                value={d.metricDeltas?.[key] ?? 0}
                onChange={e => setDelta(key, clampNum(Number(e.target.value), min, max))}
                className="human-delta-input"
              />
              <span className="human-delta-range muted">{min} to {max}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="human-form-section">
        <span className="human-form-label">Reasoning (kept on the record, same as an AI agent's)</span>
        <textarea
          className="human-reasoning-input"
          value={d.reasoning}
          onChange={e => setReasoning(e.target.value)}
          placeholder="Why this move — what constraint or objective is driving it?"
          rows={2}
        />
      </div>
    </div>
  );
}

function clampNum(v, min, max) {
  if (Number.isNaN(v)) return 0;
  return Math.min(max, Math.max(min, v));
}


function MetricEditor({ metrics, metricLabels, onChange }) {
  return (
    <div className="metric-editor">
      {Object.entries(metricLabels).map(([key, label]) => (
        <div key={key} className="metric-editor-row">
          <label className="metric-editor-label">{label}</label>
          <input
            type="number"
            className="metric-editor-input"
            value={metrics[key] ?? 0}
            onChange={e => onChange(key, Number(e.target.value))}
          />
        </div>
      ))}
    </div>
  );
}


// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export function AICycleStep({ scenario, deployment, onResults }) {
  const nationMeta     = buildNationMeta(scenario);
  const worldStateKey  = buildWorldStateKeyMap(scenario);
  const metricLabels   = buildMetricLabels(scenario);
  const nationIds      = scenario.nations.map(n => n.id);
  const { entangled, standalone, peacekeeper, marketInstruments } = scenario.aiAgents;

  const [phase,       setPhase]       = useState("idle");    // idle|thinking|review|committing
  const [maxCycles,   setMaxCycles]   = useState(DEFAULT_MAX_CYCLES); // locked in once cycle 1 starts
  const [cycle,       setCycle]       = useState(1);
  const [simState,    setSimState]    = useState(() => initSimState(scenario));
  const [agentMemory, setAgentMemory] = useState(() => ({ quantum: initQuantumBeliefs(scenario), markets: initMarketBeliefs(scenario) }));
  const [decisions,   setDecisions]   = useState(null);
  const [proposed,    setProposed]    = useState(null);      // editable aggregated metrics
  const [history,     setHistory]     = useState([]);
  const [thinking,    setThinking]    = useState({});        // per-nation loading state
  const [error,       setError]       = useState("");
  const [worldSnapshot,   setWorldSnapshot]   = useState(null); // last worldState built, for quantum readouts
  const [instinctReadings, setInstinctReadings] = useState({}); // { [nationId]: reading } — veto-capable nations only, see lib/instinct.js
  const [quantumEvent,    setQuantumEvent]    = useState(null); // Layer 1 collapse outcome from the last commit
  const [marketEvent,     setMarketEvent]     = useState(null); // Layer 2/3 collapse outcome from the last commit
  const [entropySources,  setEntropySources]  = useState(null); // which real-vs-fallback entropy sourced the last commit's Layer 1/2/3 collapse — see createRealEntropyPool
  const [humanControlled, setHumanControlled] = useState({});   // { [nationId]: boolean } — "take this nation's turn myself" toggle
  const [humanDrafts,     setHumanDrafts]     = useState({});   // { [nationId]: { primaryAction, reasoning, metricDeltas } }
  const [useRealHardware, setUseRealHardware] = useState(false); // Tier 2 opt-in (instinct veto) — see lib/agents.js's proposeInstinctReadingsViaQPU. Default OFF: ~10-15s per reading, spends real IBM Quantum quota once a token is configured server-side. Side-channel only — never feeds simState.
  const [useRealHardwareForLayer1, setUseRealHardwareForLayer1] = useState(false); // Tier 2 opt-in (the ACTUAL political collapse) — see lib/agents.js's evolveAndCollapseQuantumStateViaQPU. HIGHER STAKES than the instinct toggle above: this DOES feed the committed on-chain outcome. Default OFF.

  function updateHumanDraft(nationId, draft) {
    setHumanDrafts(prev => ({ ...prev, [nationId]: draft }));
  }

  function toggleHumanControl(nationId) {
    setHumanControlled(prev => ({ ...prev, [nationId]: !prev[nationId] }));
  }

  // A human-controlled nation needs a chosen action + non-empty reasoning
  // before a cycle can run — same bar the AI's own output format requires.
  const humanDraftInvalid = (id) => {
    if (!humanControlled[id]) return false;
    const d = humanDrafts[id];
    return !d?.primaryAction || !d?.reasoning?.trim();
  };
  const anyHumanDraftInvalid = nationIds.some(humanDraftInvalid);

  const currentMetrics = simStateToMetrics(simState);

  // ── Step 1: ask agents (or take a human-controlled nation's decision as-is) ──
  const runAgents = useCallback(async () => {
    if (nationIds.some(humanDraftInvalid)) return; // footer button is disabled too; belt and suspenders

    setError("");
    setPhase("thinking");
    setThinking(Object.fromEntries(nationIds.map(id => [id, !humanControlled[id]])));

    const worldState = buildWorldState(scenario, simState, cycle, agentMemory);
    setWorldSnapshot(worldState);

    const results = {};

    // Human-controlled nations resolve instantly — no API call, no waiting —
    // wrapped in the exact same { nation, cycle, decision, usage } shape a
    // Claude call returns, so every downstream consumer (aggregation, the
    // quantum cascade, applyDecisions, the exported run-data JSON) is
    // unchanged and can't tell the difference except via decision.source.
    for (const id of nationIds) {
      if (humanControlled[id]) {
        const draft = humanDrafts[id];
        results[id] = {
          nation: id,
          cycle,
          decision: {
            primaryAction: draft.primaryAction,
            supportingActions: [],
            reasoning: draft.reasoning,
            metricDeltas: draft.metricDeltas || {},
            source: "human",
          },
          usage: null,
        };
      }
    }

    // Fire the remaining (AI-controlled) nations in parallel, same as before
    const aiNationIds = nationIds.filter(id => !humanControlled[id]);
    const agents = aiNationIds.map(id => new NationAgent(id));

    // Instinct readings (guardian/royal veto — see lib/instinct.js) run
    // concurrently with the agents' own reasoning, not after it: this is
    // upstream, pre-deliberative pressure, not a reaction to what the AI
    // agents decide this cycle. Tier 1 (default) sources from a real
    // network call (ANU QRNG, see quantumRng.js) — failure is handled
    // inside proposeInstinctReadings/quantumRandomFloat themselves (falls
    // back to Math.random, honestly labeled). Tier 2 (opt-in toggle, see
    // useRealHardware) instead posts to real IBM quantum hardware via
    // python-bridge — slower (~10-15s/reading) and spends real quota, so
    // it's never the default; on failure it falls back to a Tier 1
    // reading itself (see proposeInstinctReadingsViaQPU), so either path
    // always resolves. .catch() here is belt-and-suspenders against
    // something unexpected still throwing (e.g. a malformed scenario
    // config), not the primary failure handling for either tier.
    const instinctPromise = (useRealHardware
      ? proposeInstinctReadingsViaQPU(scenario, worldState, agentMemory.quantum)
      : proposeInstinctReadings(scenario, worldState, agentMemory.quantum)
    ).catch(() => ({}));

    await Promise.allSettled(
      agents.map((agent, i) =>
        agent.decide(worldState, scenario.meta.id).then(r => {
          results[aiNationIds[i]] = { ...r, decision: { ...r.decision, source: "ai" } };
          setThinking(prev => ({ ...prev, [aiNationIds[i]]: false }));
        }).catch(err => {
          results[aiNationIds[i]] = { error: err.message };
          setThinking(prev => ({ ...prev, [aiNationIds[i]]: false }));
        })
      )
    );

    setInstinctReadings(await instinctPromise);

    const agg = aggregateDeltas(results);
    // Proposed = current + aggregated deltas
    const proposedMetrics = {};
    for (const k of Object.keys(metricLabels)) {
      const currentVal = currentMetrics[k] ?? 0;
      proposedMetrics[k] = currentVal + (agg[k] || 0);
    }

    setDecisions(results);
    setProposed(proposedMetrics);
    setPhase("review");
  }, [scenario, simState, cycle, agentMemory, humanControlled, humanDrafts, useRealHardware]); // eslint-disable-line react-hooks/exhaustive-deps


  // ── Step 2: researcher edits proposed values ──────────────
  function editProposed(key, value) {
    setProposed(prev => ({ ...prev, [key]: value }));
  }


  // ── Step 3: commit to chain ───────────────────────────────
  async function commitCycle() {
    setPhase("committing");

    // Apply decisions to sim state + agent memory. This is also where the
    // quantum belief state collapses (Born-rule measurement) — exactly
    // once, right here at commit, not before. The researcher's edits below
    // are the classical baseline; the entangled effect (if any) is the
    // measurement's own contribution, observed only now.
    //
    // The collapse itself is now real-entropy-sourced (ANU QRNG, PRNG
    // fallback if unreachable) — pre-fetched here, before the synchronous
    // collapse chain runs, since collapseQubit/measureA/measureQubit call
    // rng() inline and can't themselves await a network call. See
    // agents.js's createRealEntropyPool for why this is opt-in at this one
    // call site rather than the shared default every other caller
    // (including the offline statistical validation script) still uses.
    const { rng: realRng, sourcesUsed } = await createRealEntropyPool();

    // Tier 2 for Layer 1 (opt-in, higher stakes than the instinct
    // toggle — see useRealHardwareForLayer1's own declaration): if on,
    // the ACTUAL political collapse is prepared and measured on real IBM
    // hardware instead of classically sampled, computed here BEFORE
    // applyDecisions() (which stays synchronous) the same
    // resolve-before-the-sync-chain pattern as the entropy pool above.
    const politicalCollapse = useRealHardwareForLayer1
      ? await evolveAndCollapseQuantumStateViaQPU(scenario, agentMemory.quantum, decisions, agentMemory.markets?.lastEvent ?? null, cycle)
      : null;

    const { newSimState, newAgentMemory } = applyDecisions(scenario, simState, decisions, agentMemory, cycle, realRng, politicalCollapse);
    setEntropySources(sourcesUsed);
    const quantum = newAgentMemory.quantum.lastEvent;
    const market  = newAgentMemory.markets.lastEvent;

    // Override with researcher's edits, then layer the quantum measurement's
    // own effect on top (not something the researcher pre-edited). The
    // economic field is entirely Layer 2/3 output — nothing for the
    // researcher to pre-edit — so it's taken straight from newSimState.
    // Same formula the no-wallet autonomous runner uses (see
    // lib/cycleRunner.js's computeCommittedMetrics) — shared, not
    // reimplemented, since "proposed + entangled effect, clamped" has to
    // mean the same thing in both places.
    const committed = computeCommittedMetrics(proposed, quantum, newSimState);

    setQuantumEvent(quantum);
    setMarketEvent(market);

    try {
      // Update metrics AND advance the cycle in one transaction — one
      // MetaMask approval per cycle instead of two on a real network.
      await deployment.registry.commitCycle(
        BigInt(committed.stability),
        BigInt(committed.conflicts),
        BigInt(committed.trade),
        BigInt(committed.proxy),
        BigInt(committed.dealIntegrity)
      );
    } catch (err) {
      // On-chain write failed — still advance locally so researcher isn't blocked
      console.warn("On-chain write failed:", err.message);
    }

    const snapshot = { cycle, ...committed, decisions, quantum, market };
    const newHistory = [...history, snapshot];

    setHistory(newHistory);
    setSimState(committed);
    setAgentMemory(newAgentMemory);
    setDecisions(null);
    setProposed(null);
    setInstinctReadings({});

    if (cycle >= maxCycles) {
      onResults({
        history: newHistory,
        finalState: committed,
        startState: initSimState(scenario),
        registryAddress: deployment.registryAddress,
        oracleAddress: deployment.oracleAddress,
      });
    } else {
      setCycle(c => c + 1);
      setPhase("idle");
    }
  }


  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  const aNation = scenario.nations.find(n => n.id === entangled.aId);
  const bNation = scenario.nations.find(n => n.id === entangled.bId);
  const cNation = scenario.nations.find(n => n.id === standalone.id);
  const pNation = peacekeeper ? scenario.nations.find(n => n.id === peacekeeper.id) : null;

  return (
    <div className="step-panel">

      {/* Header */}
      <div className="panel-header">
        <h2>AI Agent Simulation</h2>
        <p className="muted">
          Each cycle, {joinWithAnd(scenario.nations.map(n => n.name))} reason through the world state and decide their move.
          Review their decisions, edit the proposed outcome if needed, then commit to the blockchain.
        </p>
      </div>

      {/* Cycle + metrics bar */}
      <div className="ai-status-bar">
        <div className="ai-cycle-badge">Cycle {cycle} / {maxCycles}</div>
        <div className="ai-metrics">
          {Object.entries(currentMetrics).map(([key, val]) => (
            <div key={key} className="ai-metric">
              <span className="ai-metric-label">{metricLabels[key]}</span>
              <span
                className="ai-metric-val"
                style={{ color: key === "stability" ? stabilityColor(val) : "var(--text)" }}
              >
                {val}
              </span>
            </div>
          ))}
          <div className="ai-metric">
            <span className="ai-metric-label">Status</span>
            <span className="ai-metric-val" style={{ color: stabilityColor(currentMetrics.stability) }}>
              {stabilityLabel(currentMetrics.stability)}
            </span>
          </div>
        </div>
        {/* Layer 2/3 economic field — read-only, entirely quantum-collapse output, nothing for the researcher to pre-edit */}
        <div className="ai-metrics ai-metrics--markets">
          {marketInstruments.map(inst => (
            <div key={inst.key} className="ai-metric">
              <span className="ai-metric-label">{inst.emoji} {inst.label}</span>
              <span className="ai-metric-val">{Math.round(simState.market?.[inst.key] ?? 100)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* History strip */}
      {history.length > 0 && (
        <div className="history-strip">
          {history.map(h => (
            <div key={h.cycle} className="history-tick" title={`Cycle ${h.cycle}: stability ${h.stability}`}>
              <div
                className="history-fill"
                style={{ height: `${h.stability}%`, background: stabilityColor(h.stability) }}
              />
              <div className="history-label">C{h.cycle}</div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      {/* Thinking state */}
      {phase === "thinking" && (
        <div className="thinking-grid">
          {nationIds.map(id => (
            <div key={id} className={`thinking-card ${thinking[id] ? "thinking-card--active" : "thinking-card--done"}`}>
              <span className="thinking-flag">{nationMeta[id].flag}</span>
              <span>{nationMeta[id].label}</span>
              {thinking[id]
                ? <span className="pulse" style={{ color: nationMeta[id].color }}>●</span>
                : <span style={{ color: "#22c55e" }}>✓</span>
              }
            </div>
          ))}
        </div>
      )}

      {/* Review state: nation cards + editor */}
      {phase === "review" && decisions && (
        <>
          <div className="section">
            <h3 className="section-label">Agent Decisions — Cycle {cycle}</h3>
            <div className="nation-cards-grid">
              {Object.entries(decisions).map(([id, result]) => (
                <NationCard
                  key={id}
                  nationId={id}
                  result={result}
                  quantumBeliefState={worldSnapshot?.[worldStateKey[id]]?.quantumBeliefState}
                  instinctReading={instinctReadings[id]}
                  nationMeta={nationMeta}
                  metricLabels={metricLabels}
                />
              ))}
            </div>
          </div>

          <div className="section">
            <h3 className="section-label">Economic Field (Layer 2/3)</h3>
            <p className="muted" style={{ marginBottom: "0.75rem" }}>
              {joinWithAnd(marketInstruments.map(i => i.label))} as one entangled instrument — this doesn't
              feed the agents above (political → economic is one-directional for now), it's downstream
              of their decisions. Resolves at commit, same as the political layer.
            </p>
            <div className="nation-cards-grid">
              {marketInstruments.map(inst => (
                <div key={inst.key} className="nation-card">
                  <div className="nation-card-header"><span>{inst.emoji}</span><span className="nation-name">{inst.symbol}</span></div>
                  <QuantumBeliefBar belief={worldSnapshot?.markets?.[inst.key]} />
                </div>
              ))}
            </div>
          </div>

          <div className="section">
            <h3 className="section-label">Proposed World State After Cycle {cycle}</h3>
            <p className="muted" style={{ marginBottom: "0.75rem" }}>
              These values are aggregated from every agent's metric deltas. Edit before committing.
              The quantum belief state above will collapse — and may add its own small entangled
              effect on top of these — only when you commit.
            </p>
            <MetricEditor metrics={proposed} metricLabels={metricLabels} onChange={editProposed} />
          </div>
        </>
      )}

      {/* Last quantum measurement, shown after a commit */}
      {quantumEvent && phase !== "review" && (
        <div className="section quantum-event-banner">
          <h3 className="section-label">⚛ Quantum Measurement — Cycle {history.at(-1)?.cycle ?? cycle - 1}</h3>
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            {aNation.name} collapsed to <strong>{quantumEvent[entangled.aId]?.toUpperCase()}</strong>, {bNation.name} to{" "}
            <strong>{quantumEvent[entangled.bId]?.toUpperCase()}</strong>, {cNation.name} to{" "}
            <strong>{quantumEvent[standalone.id]?.toUpperCase()}</strong>
            {pNation && quantumEvent[peacekeeper.id] && (
              <>, {pNation.name} to <strong>{quantumEvent[peacekeeper.id]?.toUpperCase()}</strong></>
            )}
            {" "}(pre-collapse: {aNation.name} {Math.round((quantumEvent.preCollapse.aProbabilities[entangled.aAxis[0]] ?? 0) * 100)}% {entangled.aAxis[0]},
            entanglement strength {quantumEvent.preCollapse.entanglementStrength.toFixed(2)}).
          </p>
          {quantumEvent.entangledEffect && (
            <p className="status-flag status-flag--alert" style={{ display: "inline-block" }}>
              {quantumEvent.entangledEffect.label}: applied on top of the classical deltas this cycle
            </p>
          )}
          {quantumEvent.peacekeeperIntervention?.dampened && (
            <p className="muted" style={{ fontSize: 11, marginTop: "0.4rem" }}>
              {pNation.name} actively mediated — the escalation effect above was dampened from
              {" "}{quantumEvent.peacekeeperIntervention.original.stability} to {quantumEvent.entangledEffect.stability} stability
              (and {quantumEvent.peacekeeperIntervention.original.conflictEvents} to {quantumEvent.entangledEffect.conflictEvents} conflict events),
              not fully cancelled.
            </p>
          )}
          {quantumEvent.collapseSource && quantumEvent.collapseSource !== "classical" && (
            <p
              className={quantumEvent.collapseSource === "qpu-real-hardware" ? "status-flag status-flag--alert" : "muted"}
              style={{ fontSize: 11, marginTop: "0.4rem", display: quantumEvent.collapseSource === "qpu-real-hardware" ? "inline-block" : "block" }}
            >
              {quantumEvent.collapseSource === "qpu-real-hardware" && (
                <>⚛ THIS COLLAPSE WAS A REAL PHYSICAL MEASUREMENT — backend {quantumEvent.backend}, job {quantumEvent.jobId}</>
              )}
              {quantumEvent.collapseSource === "qpu-fallback-simulator" && (
                <>Tier 2 was requested but IBM hardware was unreachable — this collapse used a local simulator fallback ({quantumEvent.qpuDetail ?? "reason not recorded"}), not the classical procedure either.</>
              )}
              {quantumEvent.collapseSource === "classical-fallback" && (
                <>Tier 2 was requested but the QPU endpoint failed ({quantumEvent.qpuError ?? "reason not recorded"}) — fell back to the same classical procedure this project always used before Tier 2 existed.</>
              )}
            </p>
          )}
          {entropySources && (
            <p className="muted" style={{ fontSize: 11, marginTop: "0.4rem" }}>
              This collapse (political + economic) drew {entropySources.filter(s => s === "anu-qrng").length} of{" "}
              {entropySources.length} values from real quantum entropy (ANU QRNG)
              {entropySources.some(s => s !== "anu-qrng") && (
                <> — {entropySources.filter(s => s !== "anu-qrng").length} fell back to a PRNG (ANU unreachable or pool exhausted)</>
              )}.
            </p>
          )}
        </div>
      )}

      {/* Last economic-field measurement, shown after a commit */}
      {marketEvent && phase !== "review" && (
        <div className="section quantum-event-banner">
          <h3 className="section-label">⚛ Economic Field Measurement — Cycle {history.at(-1)?.cycle ?? cycle - 1}</h3>
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            {marketInstruments.map((inst, i) => (
              <span key={inst.key}>
                {i > 0 && ", "}
                {inst.symbol} to <strong>{marketEvent.outcomes[inst.key]}</strong> ({sign(Math.round(marketEvent[`${inst.key}Delta`]))})
              </span>
            ))}
            {marketEvent.derivedNote && <>, {marketEvent.derivedNote.label.toLowerCase()} {marketEvent.derivedNote.value.toLowerCase()}</>}.
          </p>
          <p className="muted" style={{ fontSize: "11px" }}>
            {marketInstruments[0].symbol} speculation: interference weight {marketEvent.speculation.primary.interferenceWeight} vs.
            classical-additive benchmark {marketEvent.speculation.primary.classicalWeight}
            {" "}(tail weight {marketEvent.speculation.primary.tailWeight} — how much of the move came from
            the fat-tailed component rather than an ordinary one).
          </p>
        </div>
      )}

      {/* Tier 2 opt-in — see lib/agents.js's proposeInstinctReadingsViaQPU.
          Only shown when this scenario actually has a veto-capable nation
          (otherwise there'd be nothing for it to affect). Default OFF:
          each reading is a real IBM Quantum job, ~10-15s and real quota
          once a token is configured server-side — a deliberate choice,
          not an oversight, unlike Tier 1's near-instant, effectively-free
          ANU QRNG reads. */}
      {phase === "idle" && scenario.nations.some(n => n.governance?.guardianVeto || n.governance?.royalVeto) && (
        <div className="section" style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.25rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={useRealHardware}
              onChange={e => setUseRealHardware(e.target.checked)}
            />
            Use real IBM quantum hardware for instinct readings
          </label>
          <span className="muted" style={{ fontSize: 11 }}>
            {useRealHardware
              ? "⚛ each veto-capable nation's reading will be a real measurement on a real QPU (~10-15s, real quota) — falls back to a local reading if unreachable"
              : "off by default — real hardware readings are slower and spend real IBM Quantum quota"}
          </span>
        </div>
      )}

      {/* Tier 2 for Layer 1 — see lib/agents.js's
          evolveAndCollapseQuantumStateViaQPU. HIGHER STAKES than the
          instinct toggle above: that one is a side-channel display that
          never touches simState; THIS one, when on, replaces the actual
          political collapse that feeds the committed on-chain stability/
          conflict deltas. Real IBM hardware noise here changes the
          citable research record, not just a display — labeled
          accordingly (alert styling, explicit "this is what commits"
          language), not presented as an equally-casual toggle. Default OFF. */}
      {phase === "idle" && (
        <div className="section" style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.25rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={useRealHardwareForLayer1}
              onChange={e => setUseRealHardwareForLayer1(e.target.checked)}
            />
            Use real IBM quantum hardware for the political collapse itself
          </label>
          {useRealHardwareForLayer1 ? (
            <span className="status-flag status-flag--alert">
              ⚛ this cycle's entangled collapse will be a real physical measurement — feeds the committed on-chain outcome, not just a display
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 11 }}>
              off by default — real hardware noise here changes the actual research record, not a side reading
            </span>
          )}
        </div>
      )}

      {/* Per-nation human/AI control, before each cycle runs. A nation switched
          to Human skips its Claude call entirely for this cycle — you pick
          its move from the same categorized action menu the AI would choose
          from, and it feeds into the identical decision pipeline (quantum
          cascade, on-chain commit, exported run data) tagged decision.source
          so it's distinguishable afterward, not silently blended in. */}
      {phase === "idle" && (
        <div className="section human-control-section">
          <h3 className="section-label">Who decides each nation this cycle?</h3>
          <div className="human-control-grid">
            {nationIds.map(id => {
              const meta = nationMeta[id];
              const isHuman = !!humanControlled[id];
              const menuAvailable = !!nationActionMenu(scenario.meta.id, id);
              return (
                <div key={id} className="human-control-card">
                  <div className="human-control-header">
                    <span className="nation-flag">{meta.flag}</span>
                    <span className="nation-name">{meta.label}</span>
                    <div className="human-control-toggle">
                      <button
                        type="button"
                        className={`toggle-pill ${!isHuman ? "toggle-pill--active" : ""}`}
                        onClick={() => isHuman && toggleHumanControl(id)}
                      >
                        AI
                      </button>
                      <button
                        type="button"
                        className={`toggle-pill ${isHuman ? "toggle-pill--active" : ""}`}
                        disabled={!menuAvailable}
                        title={menuAvailable ? undefined : "Human mode not set up for this nation yet"}
                        onClick={() => !isHuman && toggleHumanControl(id)}
                      >
                        Human
                      </button>
                    </div>
                  </div>
                  {isHuman && (
                    <HumanDecisionForm
                      nationId={id}
                      scenarioId={scenario.meta.id}
                      nationMeta={nationMeta}
                      metricLabels={metricLabels}
                      draft={humanDrafts[id]}
                      onChange={updateHumanDraft}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {anyHumanDraftInvalid && (
            <p className="muted" style={{ fontSize: 12, marginTop: "0.5rem" }}>
              Pick a move and add reasoning for every human-controlled nation before running this cycle.
            </p>
          )}
        </div>
      )}

      {/* Cycle-count picker — only shown before cycle 1 starts, locked in after.
          Each cycle is one on-chain commit (a MetaMask approval on a real
          network), so this matters most for Sepolia — a shorter run is
          still a legitimate citable finding at a fraction of the clicks. */}
      {phase === "idle" && cycle === 1 && history.length === 0 && (
        <div className="section" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
          <span className="muted" style={{ fontSize: 13 }}>Cycles to run:</span>
          {CYCLE_COUNT_OPTIONS.map(n => (
            <button
              key={n}
              className="btn-secondary"
              style={{
                padding: "0.35rem 0.9rem",
                fontSize: 13,
                borderColor: maxCycles === n ? "var(--accent, #6366f1)" : undefined,
                opacity: maxCycles === n ? 1 : 0.6,
              }}
              onClick={() => setMaxCycles(n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {/* Footer button */}
      <div className="step-footer">
        {phase === "idle" && (
          <button className="btn-primary" onClick={runAgents} disabled={anyHumanDraftInvalid}>
            {cycle === 1 ? `Start — Run Cycle 1 of ${maxCycles}` : `Run Cycle ${cycle}`}
          </button>
        )}
        {phase === "thinking" && (
          <button className="btn-primary" disabled>Agents reasoning…</button>
        )}
        {phase === "review" && (
          <button className="btn-primary" onClick={commitCycle}>
            Commit Cycle {cycle} to Blockchain →
          </button>
        )}
        {phase === "committing" && (
          <button className="btn-primary" disabled>Writing to chain…</button>
        )}
      </div>

    </div>
  );
}
