import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { stabilityLabel, stabilityColor } from "../lib/simulation";

const NATION_META = {
  iran:         { label: "Iran",         flag: "🇮🇷", color: "#f97316" },
  israel:       { label: "Israel",       flag: "🇮🇱", color: "#6366f1" },
  saudi_arabia: { label: "Saudi Arabia", flag: "🇸🇦", color: "#eab308" },
};

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

  const start = startState ?? {
    stability: history[0]?.stability, proxy: history[0]?.proxy, trade: history[0]?.trade,
    conflicts: history[0]?.conflicts, dealIntegrity: history[0]?.dealIntegrity,
    oilPrice: 100, rialIndex: 100, riyalIndex: 100, usGasIndex: 100,
  };
  const end = finalState ?? history.at(-1) ?? start;

  const chartData = history.map(h => ({
    cycle: h.cycle, stability: h.stability, dealIntegrity: h.dealIntegrity, proxy: h.proxy,
  }));

  const marketData = history.map(h => ({
    cycle: h.cycle, oil: h.oilPrice, rial: h.rialIndex, riyal: h.riyalIndex, usGas: h.usGasIndex,
  }));

  const entangledCycles = history.filter(h => h.quantum?.entangledEffect);
  const tailWeights = history
    .map(h => h.market?.speculation?.oil?.tailWeight)
    .filter(v => typeof v === "number");
  const avgTailWeight = tailWeights.length
    ? tailWeights.reduce((a, b) => a + b, 0) / tailWeights.length
    : null;

  // Flatten every nation's decision across every cycle into one log
  const decisionRows = [];
  for (const h of history) {
    for (const [id, result] of Object.entries(h.decisions || {})) {
      const meta = NATION_META[id] ?? { label: id, flag: "🏳", color: "#888" };
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

  const comparisonRows = [
    ["Stability Index", start.stability, end.stability],
    ["Proxy Activity",  start.proxy,     end.proxy],
    ["Trade Volume",    start.trade,     end.trade],
    ["Conflict Events", start.conflicts, end.conflicts],
    ["Deal Integrity",  start.dealIntegrity, end.dealIntegrity],
    ["Oil Index",       start.oilPrice,  end.oilPrice],
    ["Rial Index",      start.rialIndex, end.rialIndex],
    ["Riyal Index",     start.riyalIndex,end.riyalIndex],
    ["US Gas Index",    start.usGasIndex,end.usGasIndex],
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
              <Line type="monotone" dataKey="stability"     stroke="#6366f1" strokeWidth={2} dot={false} name="Stability" />
              <Line type="monotone" dataKey="dealIntegrity" stroke="#eab308" strokeWidth={2} dot={false} name="Deal Integrity" />
              <Line type="monotone" dataKey="proxy"         stroke="#ef4444" strokeWidth={2} dot={false} name="Proxy Activity" />
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
              <Line type="monotone" dataKey="oil"   stroke="#f97316" strokeWidth={2} dot={false} name="Oil Index" />
              <Line type="monotone" dataKey="rial"  stroke="#22c55e" strokeWidth={2} dot={false} name="Rial Index" />
              <Line type="monotone" dataKey="riyal" stroke="#818cf8" strokeWidth={2} dot={false} name="Riyal Index" />
              <Line type="monotone" dataKey="usGas" stroke="#ef4444" strokeWidth={2} dot={false} name="US Gas Index" />
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
                  Iran → <strong>{h.quantum.iran?.toUpperCase()}</strong>,{" "}
                  Israel → <strong>{h.quantum.israel?.toUpperCase()}</strong>,{" "}
                  Saudi Arabia → <strong>{h.quantum.saudi?.toUpperCase()}</strong>
                </p>
              )}
              {h.market && (
                <p className="muted" style={{ fontSize: "11px", marginTop: "0.2rem" }}>
                  Oil → {h.market.outcomes?.oil} ({sign(h.market.oilPriceDelta)}),{" "}
                  Rial → {h.market.outcomes?.rial} ({sign(h.market.rialIndexDelta)}),{" "}
                  Riyal → {h.market.outcomes?.riyal} ({sign(h.market.riyalIndexDelta)}),{" "}
                  US Gas → {h.market.outcomes?.usGas} ({sign(h.market.usGasIndexDelta)},{" "}
                  dollar {h.market.usdDirection?.toLowerCase()})
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
