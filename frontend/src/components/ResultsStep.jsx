import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { stabilityLabel, stabilityColor, evaluateHypothesisChecks } from "../lib/simulation";

function delta(after, before) {
  const d = after - before;
  return (d >= 0 ? "+" : "") + d;
}

// Reads experiment.hypothesisChecks — a declarative list of pass/fail
// conditions defined in the scenario config — instead of branching on
// hardcoded experiment ids. See scenarios/*.config.cjs and
// lib/simulation.js's evaluateHypothesisChecks().
function HypothesisCheck({ experiment, baseline, expEnd, expHistory }) {
  const results = evaluateHypothesisChecks(experiment.hypothesisChecks, { baseline, expEnd, expHistory });
  const passed = results.filter(r => r.passed).length;

  return (
    <div className="hypothesis-block">
      <div className="hypothesis-score">{passed}/{results.length} confirmed</div>
      <ul className="hypothesis-list">
        {results.map((r, i) => (
          <li key={i} className={r.passed ? "check-pass" : "check-fail"}>
            {r.passed ? "✓" : "✗"} {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResultsStep({ results, onReset }) {
  const { experiment, baseline, expEnd, baseHistory, expHistory,
          baseRegistryAddr, baseOracleAddr, expRegistryAddr, expOracleAddr, cycles } = results;

  // Merge histories for chart
  const chartData = baseHistory.map((b, i) => ({
    cycle:      b.cycle,
    baseline:   b.stability,
    experiment: expHistory[i]?.stability ?? null,
  }));

  const metrics = [
    { name: "Stability Index",  b: baseline.stability,     e: expEnd.stability,     unit: "/100" },
    { name: "Conflict Events",  b: baseline.conflicts,     e: expEnd.conflicts,     unit: "" },
    { name: "Trade Volume",     b: baseline.trade,         e: expEnd.trade,         unit: "" },
    { name: "Proxy Activity",   b: baseline.proxy,         e: expEnd.proxy,         unit: "/100" },
    { name: "Deal Integrity",   b: baseline.dealIntegrity, e: expEnd.dealIntegrity, unit: "/100" },
  ];

  return (
    <div className="step-panel">
      <div className="panel-header">
        <h2>Research Findings</h2>
        <p className="exp-title">{experiment.name}</p>
        <blockquote className="question-block">"{experiment.question}"</blockquote>
      </div>

      {/* Stability trajectory chart */}
      <section className="section">
        <h3>Stability Trajectory</h3>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis dataKey="cycle" label={{ value: "Cycle", position: "insideBottom", offset: -2 }} stroke="#666" />
              <YAxis domain={[0, 100]} stroke="#666" />
              <Tooltip
                contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 6 }}
                labelStyle={{ color: "#aaa" }}
              />
              <Legend />
              <Line
                type="monotone" dataKey="baseline"
                stroke="#6366f1" strokeWidth={2} dot={false} name="Baseline (no change)"
              />
              <Line
                type="monotone" dataKey="experiment"
                stroke="#ef4444" strokeWidth={2} dot={false} name={experiment.name}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Metrics comparison */}
      <section className="section">
        <h3>Metric Comparison — End of Simulation</h3>
        <table className="results-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Baseline</th>
              <th>Experiment</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map(m => {
              const d = m.e - m.b;
              const sig = Math.abs(d) >= 15;
              return (
                <tr key={m.name} className={sig ? "sig-row" : ""}>
                  <td>{m.name}</td>
                  <td>{m.b}{m.unit}</td>
                  <td style={{ color: stabilityColor(m.name === "Stability Index" ? m.e : 50) }}>
                    {m.e}{m.unit}
                  </td>
                  <td className={d > 0 ? "delta-pos" : d < 0 ? "delta-neg" : ""}>
                    {delta(m.e, m.b)}{sig ? " ◄" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Stability summary */}
      <section className="section">
        <h3>Stability Summary</h3>
        <div className="stability-summary">
          <div className="stab-card">
            <span className="stab-label">Baseline</span>
            <span className="stab-score" style={{ color: stabilityColor(baseline.stability) }}>
              {baseline.stability}/100
            </span>
            <span className="stab-rating">{stabilityLabel(baseline.stability)}</span>
          </div>
          <div className="stab-arrow">→</div>
          <div className="stab-card">
            <span className="stab-label">{experiment.name}</span>
            <span className="stab-score" style={{ color: stabilityColor(expEnd.stability) }}>
              {expEnd.stability}/100
            </span>
            <span className="stab-rating">{stabilityLabel(expEnd.stability)}</span>
          </div>
        </div>
      </section>

      {/* Hypothesis evaluation */}
      <section className="section">
        <h3>Hypothesis Evaluation</h3>
        <blockquote className="hypothesis-text">"{experiment.hypothesis}"</blockquote>
        <HypothesisCheck
          experiment={experiment}
          baseline={baseline}
          expEnd={expEnd}
          expHistory={expHistory}
        />
      </section>

      {/* Blockchain audit trail */}
      <section className="section">
        <h3>Blockchain Audit Trail</h3>
        <p className="muted">
          {cycles * 2} cycles recorded on-chain across two deployments.
          Every metric change is timestamped and immutable.
          Researchers can cite specific block numbers.
        </p>
        <div className="audit-grid">
          <div className="audit-block">
            <div className="audit-label">Baseline — WorldRegistry</div>
            <code className="audit-addr">{baseRegistryAddr}</code>
            <div className="audit-label">Baseline — MetricsOracle</div>
            <code className="audit-addr">{baseOracleAddr}</code>
          </div>
          <div className="audit-block">
            <div className="audit-label">Experiment — WorldRegistry</div>
            <code className="audit-addr">{expRegistryAddr}</code>
            <div className="audit-label">Experiment — MetricsOracle</div>
            <code className="audit-addr">{expOracleAddr}</code>
          </div>
        </div>
      </section>

      <div className="step-footer">
        <button className="btn-secondary" onClick={onReset}>
          ← Run Another Experiment
        </button>
      </div>
    </div>
  );
}
