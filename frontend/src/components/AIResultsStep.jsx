import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { stabilityLabel, stabilityColor } from "../lib/simulation";

const METRIC_ID_TO_KEY = {
  stability_index: "stability",
  proxy_activity:  "proxy",
  trade_volume:    "trade",
  conflict_events: "conflicts",
  deal_integrity:  "dealIntegrity",
};

// Same 4-slot palette regardless of which real-world instruments fill the
// slots — see scenario.aiAgents.marketInstruments for what "primary"/
// "currencyA"/"currencyB"/"global" mean in a given scenario.
const MARKET_COLORS = { primary: "#f97316", currencyA: "#22c55e", currencyB: "#818cf8", global: "#ef4444" };

function buildNationMeta(scenario) {
  return Object.fromEntries(scenario.nations.map(n => [n.id, { label: n.name, flag: n.flag, color: n.color }]));
}

function sign(v) {
  const r = Math.round(v ?? 0);
  return r > 0 ? `+${r}` : String(r);
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function AIResultsStep({ results, scenario, onReset }) {
  const { history, finalState, startState, registryAddress, oracleAddress } = results;
  const nationMeta = buildNationMeta(scenario);
  const { entangled, standalone, marketInstruments } = scenario.aiAgents;

  const aNation = scenario.nations.find(n => n.id === entangled.aId);
  const bNation = scenario.nations.find(n => n.id === entangled.bId);
  const cNation = scenario.nations.find(n => n.id === standalone.id);

  const defaultMarket = { primary: 100, currencyA: 100, currencyB: 100, global: 100 };
  const start = startState ?? {
    stability: history[0]?.stability, proxy: history[0]?.proxy, trade: history[0]?.trade,
    conflicts: history[0]?.conflicts, dealIntegrity: history[0]?.dealIntegrity,
    market: defaultMarket,
  };
  const end = finalState ?? history.at(-1) ?? start;

  const chartData = history.map(h => ({
    cycle: h.cycle, stability: h.stability, dealIntegrity: h.dealIntegrity, proxy: h.proxy,
  }));

  const marketData = history.map(h => ({
    cycle: h.cycle,
    primary: h.market?.primary, currencyA: h.market?.currencyA,
    currencyB: h.market?.currencyB, global: h.market?.global,
  }));

  const entangledCycles = history.filter(h => h.quantum?.entangledEffect);
  const tailWeights = history
    .map(h => h.market?.speculation?.primary?.tailWeight)
    .filter(v => typeof v === "number");
  const avgTailWeight = tailWeights.length
    ? tailWeights.reduce((a, b) => a + b, 0) / tailWeights.length
    : null;

  // Flatten every nation's decision across every cycle into one log
  const decisionRows = [];
  for (const h of history) {
    for (const [id, result] of Object.entries(h.decisions || {})) {
      const meta = nationMeta[id] ?? { label: id, flag: "🏳", color: "#888" };
      if (result.error) {
        decisionRows.push({ key: `${h.cycle}-${id}`, cycle: h.cycle, meta, error: result.error });
        continue;
      }
      const d = result.decision;
      if (!d) continue;
      decisionRows.push({
        key: `${h.cycle}-${id}`,
        cycle: h.cycle,
        meta,
        stance: d.coalitionSignal || d.coalitionStatus || "—",
        action: d.primaryAction,
        reasoning: d.reasoning,
      });
    }
  }

  const metricLabels = Object.fromEntries(
    scenario.simulation.metrics
      .map(m => [METRIC_ID_TO_KEY[m.id], m.name])
      .filter(([key]) => key)
  );

  const comparisonRows = [
    [metricLabels.stability,     start.stability,      end.stability],
    [metricLabels.proxy,         start.proxy,          end.proxy],
    [metricLabels.trade,         start.trade,          end.trade],
    [metricLabels.conflicts,     start.conflicts,      end.conflicts],
    [metricLabels.dealIntegrity, start.dealIntegrity,  end.dealIntegrity],
    ...marketInstruments.map(inst => [inst.label, start.market?.[inst.key] ?? 100, end.market?.[inst.key] ?? 100]),
  ];

  return (
    <div className="step-panel">
      <div className="panel-header">
        <h2>AI Agent Simulation — Results</h2>
        {scenario?.meta?.name && <p className="exp-title">{scenario.meta.name}</p>}
        <p className="muted">
          {history.length} cycles of Claude-driven nation decisions, quantum-informed collapse, and on-chain commitment.
        </p>
      </div>

      {/* Political trajectory */}
      <section className="section">
        <h3>Political Trajectory</h3>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis dataKey="cycle" label={{ value: "Cycle", position: "insideBottom", offset: -2 }} stroke="#666" />
              <YAxis domain={[0, 100]} stroke="#666" />
              <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 6 }} labelStyle={{ color: "#aaa" }} />
              <Legend />
              <Line type="monotone" dataKey="stability"     stroke="#6366f1" strokeWidth={2} dot={false} name={metricLabels.stability} />
              <Line type="monotone" dataKey="dealIntegrity" stroke="#eab308" strokeWidth={2} dot={false} name={metricLabels.dealIntegrity} />
              <Line type="monotone" dataKey="proxy"         stroke="#ef4444" strokeWidth={2} dot={false} name={metricLabels.proxy} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Economic field trajectory */}
      <section className="section">
        <h3>Economic Field (Layer 2/3)</h3>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={marketData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis dataKey="cycle" stroke="#666" />
              <YAxis stroke="#666" />
              <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 6 }} labelStyle={{ color: "#aaa" }} />
              <Legend />
              {marketInstruments.map(inst => (
                <Line key={inst.key} type="monotone" dataKey={inst.key} stroke={MARKET_COLORS[inst.key]} strokeWidth={2} dot={false} name={inst.label} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {avgTailWeight != null && (
          <p className="muted">
            Avg. speculation tail weight across {tailWeights.length} cycles: {avgTailWeight.toFixed(2)} — the share
            of each price move attributable to interference-driven fat tails rather than ordinary variance.
          </p>
        )}
      </section>

      {/* Stability summary */}
      <section className="section">
        <h3>Stability Summary</h3>
        <div className="stability-summary">
          <div className="stab-card">
            <span className="stab-label">Cycle 0 (Start)</span>
            <span className="stab-score" style={{ color: stabilityColor(start.stability) }}>{start.stability}/100</span>
            <span className="stab-rating">{stabilityLabel(start.stability)}</span>
          </div>
          <div className="stab-arrow">→</div>
          <div className="stab-card">
            <span className="stab-label">Cycle {history.length} (End)</span>
            <span className="stab-score" style={{ color: stabilityColor(end.stability) }}>{end.stability}/100</span>
            <span className="stab-rating">{stabilityLabel(end.stability)}</span>
          </div>
        </div>
      </section>

      {/* Metric comparison table */}
      <section className="section">
        <h3>Metric Comparison — Start vs. End</h3>
        <table className="results-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Cycle 0</th>
              <th>Cycle {history.length}</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            {comparisonRows.map(([name, b, e]) => {
              const d = e - b;
              const sig = Math.abs(d) >= 15;
              return (
                <tr key={name} className={sig ? "sig-row" : ""}>
                  <td>{name}</td>
                  <td>{b}</td>
                  <td>{e}</td>
                  <td className={d > 0 ? "delta-pos" : d < 0 ? "delta-neg" : ""}>
                    {sign(d)}{sig ? " ◄" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Quantum measurement log */}
      <section className="section">
        <h3 className="section-label">Quantum Measurement Log</h3>
        <p className="muted" style={{ marginBottom: "0.25rem" }}>
          {entangledCycles.length} of {history.length} cycles landed in a mutually reinforcing state
          (entangled escalation applied on top of the classical deltas).
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {history.map(h => (
            <div key={h.cycle} className="quantum-event-banner">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong>Cycle {h.cycle}</strong>
                {h.quantum?.entangledEffect && (
                  <span className="status-flag status-flag--alert">{h.quantum.entangledEffect.label}</span>
                )}
              </div>
              {h.quantum && (
                <p className="muted" style={{ marginTop: "0.3rem" }}>
                  {aNation.name} → <strong>{h.quantum[entangled.aId]?.toUpperCase()}</strong>,{" "}
                  {bNation.name} → <strong>{h.quantum[entangled.bId]?.toUpperCase()}</strong>,{" "}
                  {cNation.name} → <strong>{h.quantum[standalone.id]?.toUpperCase()}</strong>
                </p>
              )}
              {h.market && (
                <p className="muted" style={{ fontSize: "11px", marginTop: "0.2rem" }}>
                  {marketInstruments.map((inst, i) => (
                    <span key={inst.key}>
                      {i > 0 && ", "}
                      {inst.symbol} → {h.market.outcomes?.[inst.key]} ({sign(h.market[`${inst.key}Delta`])})
                    </span>
                  ))}
                  {h.market.derivedNote && <>, {h.market.derivedNote.label.toLowerCase()} {h.market.derivedNote.value.toLowerCase()}</>}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Full decision log */}
      <section className="section">
        <h3 className="section-label">Agent Decision Log</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="results-table">
            <thead>
              <tr>
                <th>Cycle</th>
                <th>Nation</th>
                <th>Stance</th>
                <th>Action</th>
                <th>Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {decisionRows.map(r => (
                <tr key={r.key}>
                  <td>{r.cycle}</td>
                  <td style={{ color: r.meta.color }}>{r.meta.flag} {r.meta.label}</td>
                  {r.error ? (
                    <td colSpan={3} style={{ color: "var(--red)" }}>{r.error}</td>
                  ) : (
                    <>
                      <td>{r.stance}</td>
                      <td>{r.action}</td>
                      <td title={r.reasoning} style={{ maxWidth: 360, whiteSpace: "normal", fontFamily: "inherit" }}>
                        {truncate(r.reasoning, 140)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Blockchain audit trail */}
      {(registryAddress || oracleAddress) && (
        <section className="section">
          <h3>Blockchain Audit Trail</h3>
          <p className="muted">
            {history.length} cycles recorded on-chain. Every agent decision, quantum collapse, and metric
            change is timestamped and immutable. Researchers can cite specific block numbers.
          </p>
          <div className="audit-grid" style={{ gridTemplateColumns: "1fr" }}>
            <div className="audit-block">
              <div className="audit-label">WorldRegistry</div>
              <code className="audit-addr">{registryAddress}</code>
              <div className="audit-label">MetricsOracle</div>
              <code className="audit-addr">{oracleAddress}</code>
            </div>
          </div>
        </section>
      )}

      <div className="step-footer">
        <button className="btn-secondary" onClick={onReset}>
          ← Run Another AI Cycle Set
        </button>
      </div>
    </div>
  );
}
