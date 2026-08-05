import { useState, useCallback } from "react";
import { NationAgent, buildWorldState, applyDecisions, initQuantumBeliefs, initMarketBeliefs } from "../lib/agents";
import { stabilityLabel, stabilityColor } from "../lib/simulation";

const MAX_CYCLES = 10;

const NATION_META = {
  iran:         { label: "Iran",         flag: "🇮🇷", color: "#f97316" },
  israel:       { label: "Israel",       flag: "🇮🇱", color: "#6366f1" },
  saudi_arabia: { label: "Saudi Arabia", flag: "🇸🇦", color: "#eab308" },
};

// nationId (as used in decisions/agents) -> key in the worldState object
// built by buildWorldState()
const WORLD_STATE_KEY = {
  iran: "iran",
  israel: "israel",
  saudi_arabia: "saudiArabia",
};

const METRIC_LABELS = {
  stability:     "Stability",
  proxyActivity: "Proxy Activity",
  tradeVolume:   "Trade Volume",
  conflictEvents:"Conflict Events",
  dealIntegrity: "Deal Integrity",
};

// ─────────────────────────────────────────────
// Starting sim state from scenario config
// ─────────────────────────────────────────────
function initSimState(scenario) {
  const m = scenario.simulation.metrics;
  return {
    stability:    m.find(x => x.id === "stability_index").startingValue,
    conflicts:    m.find(x => x.id === "conflict_events").startingValue,
    trade:        m.find(x => x.id === "trade_volume").startingValue,
    proxy:        m.find(x => x.id === "proxy_activity").startingValue,
    dealIntegrity:m.find(x => x.id === "deal_integrity").startingValue,
    // Layer 2 economic field — index values, 100 = baseline at scenario start.
    oilPrice:     100,
    rialIndex:    100,
    riyalIndex:   100,
    usGasIndex:   100,
  };
}

// Map simState field names → METRIC_LABELS keys
function simStateToMetrics(s) {
  return {
    stability:     s.stability,
    proxyActivity: s.proxy,
    tradeVolume:   s.trade,
    conflictEvents:s.conflicts,
    dealIntegrity: s.dealIntegrity,
  };
}

// Aggregate all three nations' metricDeltas into one object
function aggregateDeltas(decisions) {
  const agg = { stability: 0, proxyActivity: 0, tradeVolume: 0, conflictEvents: 0, dealIntegrity: 0 };
  for (const result of Object.values(decisions)) {
    if (result.error || !result.decision?.metricDeltas) continue;
    for (const [k, v] of Object.entries(result.decision.metricDeltas)) {
      if (k in agg) agg[k] = (agg[k] || 0) + (v || 0);
    }
  }
  return agg;
}

function deltaColor(v) {
  if (v > 0) return "#22c55e";
  if (v < 0) return "#ef4444";
  return "#666";
}

function sign(v) { return v > 0 ? `+${v}` : String(v); }


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

function NationCard({ nationId, result, quantumBeliefState }) {
  const meta = NATION_META[nationId];
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

  return (
    <div className="nation-card" style={{ "--nation-color": meta.color }}>
      <div className="nation-card-header">
        <span className="nation-flag">{meta.flag}</span>
        <span className="nation-name">{meta.label}</span>
        <span className="nation-coalition" style={{ color: meta.color }}>
          {d.coalitionSignal || d.coalitionStatus || "—"}
        </span>
      </div>

      <QuantumBeliefBar belief={quantumBeliefState} />

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
          .filter(([k]) => k in METRIC_LABELS)
          .map(([k, v]) => (
            <div key={k} className="delta-row">
              <span className="delta-label">{METRIC_LABELS[k]}</span>
              <span className="delta-val" style={{ color: deltaColor(v) }}>{sign(v)}</span>
            </div>
          ))}
      </div>

      {/* Nation-specific status flags */}
      <div className="nation-status-flags">
        {d.hormuzStatus    && <span className="status-flag">Hormuz: {d.hormuzStatus}</span>}
        {d.nuclearStatus   && <span className="status-flag">Nuclear: {d.nuclearStatus}</span>}
        {d.existentialFrameActive && <span className="status-flag status-flag--alert">EXISTENTIAL FRAME</span>}
        {d.oilProductionStance    && <span className="status-flag">Oil: {d.oilProductionStance}</span>}
        {d.normalizationStatus    && <span className="status-flag">Normalization: {d.normalizationStatus}</span>}
      </div>

      <div className="nation-research-note muted">{d.researchNote}</div>
    </div>
  );
}


function MetricEditor({ metrics, onChange }) {
  return (
    <div className="metric-editor">
      {Object.entries(METRIC_LABELS).map(([key, label]) => (
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

export function AICycleStep({ signer, scenario, deployment, onResults }) {
  const [phase,       setPhase]       = useState("idle");    // idle|thinking|review|committing
  const [cycle,       setCycle]       = useState(1);
  const [simState,    setSimState]    = useState(() => initSimState(scenario));
  const [agentMemory, setAgentMemory] = useState(() => ({ quantum: initQuantumBeliefs(scenario), markets: initMarketBeliefs() }));
  const [decisions,   setDecisions]   = useState(null);
  const [proposed,    setProposed]    = useState(null);      // editable aggregated metrics
  const [history,     setHistory]     = useState([]);
  const [thinking,    setThinking]    = useState({});        // per-nation loading state
  const [error,       setError]       = useState("");
  const [worldSnapshot,   setWorldSnapshot]   = useState(null); // last worldState built, for quantum readouts
  const [quantumEvent,    setQuantumEvent]    = useState(null); // Layer 1 collapse outcome from the last commit
  const [marketEvent,     setMarketEvent]     = useState(null); // Layer 2/3 collapse outcome from the last commit

  const currentMetrics = simStateToMetrics(simState);

  // ── Step 1: ask agents ────────────────────────────────────
  const runAgents = useCallback(async () => {
    setError("");
    setPhase("thinking");
    setThinking({ iran: true, israel: true, saudi_arabia: true });

    const worldState = buildWorldState(scenario, simState, cycle, agentMemory);
    setWorldSnapshot(worldState);

    // Fire all three in parallel, update loading state as each resolves
    const nations  = ["iran", "israel", "saudi_arabia"];
    const agents   = nations.map(id => new NationAgent(id));
    const results  = {};

    await Promise.allSettled(
      agents.map((agent, i) =>
        agent.decide(worldState).then(r => {
          results[nations[i]] = r;
          setThinking(prev => ({ ...prev, [nations[i]]: false }));
        }).catch(err => {
          results[nations[i]] = { error: err.message };
          setThinking(prev => ({ ...prev, [nations[i]]: false }));
        })
      )
    );

    const agg = aggregateDeltas(results);
    // Proposed = current + aggregated deltas
    const proposedMetrics = {};
    for (const [k, label] of Object.entries(METRIC_LABELS)) {
      const currentVal = currentMetrics[k] ?? 0;
      proposedMetrics[k] = currentVal + (agg[k] || 0);
    }

    setDecisions(results);
    setProposed(proposedMetrics);
    setPhase("review");
  }, [scenario, simState, cycle, agentMemory]);


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
    const { newSimState, newAgentMemory } = applyDecisions(simState, decisions, agentMemory, cycle);
    const quantum = newAgentMemory.quantum.lastEvent;
    const market  = newAgentMemory.markets.lastEvent;

    const clamp = (v, min, max) => Math.min(max, Math.max(min, Math.round(v)));

    // Override with researcher's edits, then layer the quantum measurement's
    // own effect on top (not something the researcher pre-edited). Oil/rial/
    // riyal are entirely Layer 2/3 output — nothing for the researcher to
    // pre-edit — so they're taken straight from newSimState.
    const committed = {
      stability:     clamp(proposed.stability     + (quantum.entangledEffect?.stability      ?? 0), 0, 100),
      proxy:         clamp(proposed.proxyActivity, 0, 100),
      trade:         clamp(proposed.tradeVolume,   0, 500),
      conflicts:     clamp(proposed.conflictEvents + (quantum.entangledEffect?.conflictEvents ?? 0), 0, 999),
      dealIntegrity: clamp(proposed.dealIntegrity  + (quantum.entangledEffect?.dealIntegrity  ?? 0), 0, 100),
      oilPrice:      clamp(newSimState.oilPrice,   0, 300),
      rialIndex:     clamp(newSimState.rialIndex,  0, 300),
      riyalIndex:    clamp(newSimState.riyalIndex, 0, 300),
      usGasIndex:    clamp(newSimState.usGasIndex, 0, 300),
    };

    setQuantumEvent(quantum);
    setMarketEvent(market);

    try {
      // Write to oracle
      await deployment.oracle.updateMetrics(
        BigInt(committed.stability),
        BigInt(committed.conflicts),
        BigInt(committed.trade),
        BigInt(committed.proxy),
        BigInt(committed.dealIntegrity)
      );
      // Advance cycle on registry
      await deployment.registry.advanceCycle();
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

    if (cycle >= MAX_CYCLES) {
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

  return (
    <div className="step-panel">

      {/* Header */}
      <div className="panel-header">
        <h2>AI Agent Simulation</h2>
        <p className="muted">
          Each cycle, Iran, Israel, and Saudi Arabia reason through the world state and decide their move.
          Review their decisions, edit the proposed outcome if needed, then commit to the blockchain.
        </p>
      </div>

      {/* Cycle + metrics bar */}
      <div className="ai-status-bar">
        <div className="ai-cycle-badge">Cycle {cycle} / {MAX_CYCLES}</div>
        <div className="ai-metrics">
          {Object.entries(currentMetrics).map(([key, val]) => (
            <div key={key} className="ai-metric">
              <span className="ai-metric-label">{METRIC_LABELS[key]}</span>
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
          <div className="ai-metric">
            <span className="ai-metric-label">🛢 Oil Index</span>
            <span className="ai-metric-val">{Math.round(simState.oilPrice ?? 100)}</span>
          </div>
          <div className="ai-metric">
            <span className="ai-metric-label">Rial Index</span>
            <span className="ai-metric-val">{Math.round(simState.rialIndex ?? 100)}</span>
          </div>
          <div className="ai-metric">
            <span className="ai-metric-label">Riyal Index</span>
            <span className="ai-metric-val">{Math.round(simState.riyalIndex ?? 100)}</span>
          </div>
          <div className="ai-metric">
            <span className="ai-metric-label">⛽ US Gas Index</span>
            <span className="ai-metric-val">{Math.round(simState.usGasIndex ?? 100)}</span>
          </div>
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
          {Object.entries(NATION_META).map(([id, meta]) => (
            <div key={id} className={`thinking-card ${thinking[id] ? "thinking-card--active" : "thinking-card--done"}`}>
              <span className="thinking-flag">{meta.flag}</span>
              <span>{meta.label}</span>
              {thinking[id]
                ? <span className="pulse" style={{ color: meta.color }}>●</span>
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
                  quantumBeliefState={worldSnapshot?.[WORLD_STATE_KEY[id]]?.quantumBeliefState}
                />
              ))}
            </div>
          </div>

          <div className="section">
            <h3 className="section-label">Economic Field (Layer 2/3)</h3>
            <p className="muted" style={{ marginBottom: "0.75rem" }}>
              Oil, the rial, and the riyal's fiscal position as one entangled instrument — this doesn't
              feed the agents above (political → economic is one-directional for now), it's downstream
              of their decisions. Resolves at commit, same as the political layer.
            </p>
            <div className="nation-cards-grid">
              <div className="nation-card">
                <div className="nation-card-header"><span>🛢</span><span className="nation-name">Oil</span></div>
                <QuantumBeliefBar belief={worldSnapshot?.markets?.oil} />
              </div>
              <div className="nation-card">
                <div className="nation-card-header"><span>🇮🇷</span><span className="nation-name">Rial</span></div>
                <QuantumBeliefBar belief={worldSnapshot?.markets?.rial} />
              </div>
              <div className="nation-card">
                <div className="nation-card-header"><span>🇸🇦</span><span className="nation-name">Riyal</span></div>
                <QuantumBeliefBar belief={worldSnapshot?.markets?.riyal} />
              </div>
              <div className="nation-card">
                <div className="nation-card-header"><span>⛽</span><span className="nation-name">US Gas / USD</span></div>
                <QuantumBeliefBar belief={worldSnapshot?.markets?.usGas} />
              </div>
            </div>
          </div>

          <div className="section">
            <h3 className="section-label">Proposed World State After Cycle {cycle}</h3>
            <p className="muted" style={{ marginBottom: "0.75rem" }}>
              These values are aggregated from all three agents' metric deltas. Edit before committing.
              The quantum belief state above will collapse — and may add its own small entangled
              effect on top of these — only when you commit.
            </p>
            <MetricEditor metrics={proposed} onChange={editProposed} />
          </div>
        </>
      )}

      {/* Last quantum measurement, shown after a commit */}
      {quantumEvent && phase !== "review" && (
        <div className="section quantum-event-banner">
          <h3 className="section-label">⚛ Quantum Measurement — Cycle {history.at(-1)?.cycle ?? cycle - 1}</h3>
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            Iran collapsed to <strong>{quantumEvent.iran.toUpperCase()}</strong>, Israel to{" "}
            <strong>{quantumEvent.israel.toUpperCase()}</strong>, Saudi Arabia to{" "}
            <strong>{quantumEvent.saudi.toUpperCase()}</strong>
            {" "}(pre-collapse: Iran {Math.round(quantumEvent.preCollapse.iranProbabilities.hardline * 100)}% hardline,
            entanglement strength {quantumEvent.preCollapse.entanglementStrength.toFixed(2)}).
          </p>
          {quantumEvent.entangledEffect && (
            <p className="status-flag status-flag--alert" style={{ display: "inline-block" }}>
              {quantumEvent.entangledEffect.label}: applied on top of the classical deltas this cycle
            </p>
          )}
        </div>
      )}

      {/* Last economic-field measurement, shown after a commit */}
      {marketEvent && phase !== "review" && (
        <div className="section quantum-event-banner">
          <h3 className="section-label">⚛ Economic Field Measurement — Cycle {history.at(-1)?.cycle ?? cycle - 1}</h3>
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            Oil collapsed to <strong>{marketEvent.outcomes.oil}</strong> ({sign(Math.round(marketEvent.oilPriceDelta))}),
            {" "}Rial to <strong>{marketEvent.outcomes.rial}</strong> ({sign(Math.round(marketEvent.rialIndexDelta))}),
            {" "}Riyal to <strong>{marketEvent.outcomes.riyal}</strong> ({sign(Math.round(marketEvent.riyalIndexDelta))}),
            {" "}US Gas to <strong>{marketEvent.outcomes.usGas}</strong> ({sign(Math.round(marketEvent.usGasIndexDelta))},
            {" "}dollar {marketEvent.usdDirection?.toLowerCase()}).
          </p>
          <p className="muted" style={{ fontSize: "11px" }}>
            Oil speculation: interference weight {marketEvent.speculation.oil.interferenceWeight} vs.
            classical-additive benchmark {marketEvent.speculation.oil.classicalWeight}
            {" "}(tail weight {marketEvent.speculation.oil.tailWeight} — how much of the move came from
            the fat-tailed component rather than an ordinary one).
          </p>
        </div>
      )}

      {/* Footer button */}
      <div className="step-footer">
        {phase === "idle" && (
          <button className="btn-primary" onClick={runAgents}>
            {cycle === 1 ? "Start — Run Cycle 1" : `Run Cycle ${cycle}`}
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
