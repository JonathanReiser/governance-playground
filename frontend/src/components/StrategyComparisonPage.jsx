import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList, ResponsiveContainer,
} from "recharts";
import { stabilityColor } from "../lib/simulation";

const GRID_STROKE = "var(--border)";
const AXIS_STROKE = "var(--muted)";
const TOOLTIP_STYLE = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6 };
const TOOLTIP_LABEL_STYLE = { color: "var(--muted)" };

function finalStabilityOf(trial) {
  const last = trial.cycles.at(-1);
  return last?.committed?.stability ?? last?.stability ?? null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function armLabel(registration) {
  return registration.startingConditionIds.length > 0
    ? registration.startingConditionIds.join(" + ")
    : "as researched (baseline)";
}

/**
 * Several batches side by side — `?compare=<hash1>,<hash2>,...` — for
 * "which of these real, cited alternatives actually performs best," not
 * just one batch's own single hypothesis vs. baseline (that's
 * BatchResultsPage.jsx's job; this page is what you land on once you've
 * run several arms and want the ranking, not one report at a time).
 *
 * Every arm here needs to have run the SAME cyclesPerTrial for the
 * comparison to mean anything — this page doesn't enforce that (each
 * arm's own registration is independent, deliberately: nothing forces a
 * researcher to design a valid comparison), it just shows what's there.
 * Read the actual registered config for each arm before trusting a
 * ranking, the same way you'd read a paper's methods section.
 */
export function StrategyComparisonPage({ hashList, onBack }) {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/batch-compare?hashes=${encodeURIComponent(hashList)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) return setState({ status: "error", error: data.error || "Comparison failed" });
        setState({ status: "ready", arms: data.arms });
      } catch (err) {
        if (!cancelled) setState({ status: "error", error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [hashList]);

  if (state.status === "loading") {
    return (
      <div className="step-panel center-panel">
        <div className="connect-card" style={{ maxWidth: 480, margin: "0 auto" }}>
          <p className="muted">Loading comparison…</p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="step-panel center-panel">
        <div className="connect-card" style={{ maxWidth: 480, margin: "0 auto" }}>
          <div className="error-box">{state.error}</div>
          <button className="btn-secondary" style={{ marginTop: "0.75rem", fontSize: 12 }} onClick={onBack}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  const valid = state.arms.filter((a) => !a.error && a.result);
  const broken = state.arms.filter((a) => a.error || !a.result);

  const chartData = valid
    .map((a) => ({
      label: armLabel(a.registration),
      median: median(a.result.trials.map(finalStabilityOf).filter((v) => v != null)),
      hash: a.hash,
    }))
    .sort((a, b) => b.median - a.median);

  return (
    <div className="step-panel">
      <div className="panel-header">
        <h2>Strategy Comparison</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          {valid.length} real batch{valid.length === 1 ? "" : "es"} of independent trials, ranked by median final
          Regional Stability Index — which of these actually performs best, not just whether one differs from
          baseline. Each arm's own hypothesis was registered before its trials ran; click through to verify any
          of them individually.
        </p>
      </div>

      <section className="section">
        <h3>Ranked by median final stability</h3>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 60)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 40, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis type="number" domain={[0, 100]} stroke={AXIS_STROKE} />
              <YAxis type="category" dataKey="label" stroke={AXIS_STROKE} width={220} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
              <Bar dataKey="median" isAnimationActive={false}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={stabilityColor(d.median)} />
                ))}
                <LabelList dataKey="median" position="right" style={{ fill: "var(--text)", fontSize: 12 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="section">
        <h3>Every arm</h3>
        <div className="chart-wrap" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {valid.map((a) => {
            const finals = a.result.trials.map(finalStabilityOf).filter((v) => v != null);
            return (
              <div key={a.hash} style={{ borderTop: "1px solid var(--border)", paddingTop: "0.6rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                  <strong style={{ fontSize: 13 }}>{armLabel(a.registration)}</strong>
                  <a href={`?batch=${a.hash.slice(0, 16)}`} style={{ fontSize: 12 }}>
                    {a.report?.ok ? "✅" : "❌"} view details →
                  </a>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: "0.15rem" }}>{a.registration.hypothesis}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: "0.2rem", fontFamily: "monospace" }}>
                  median {median(finals).toFixed(0)} · mean {(finals.reduce((x, y) => x + y, 0) / finals.length).toFixed(1)} ·
                  {" "}min {Math.min(...finals)} · max {Math.max(...finals)} · {finals.length} trials × {a.registration.cyclesPerTrial} cycles
                </div>
              </div>
            );
          })}
          {broken.map((a) => (
            <div key={a.hashPrefix || a.hash} className="muted" style={{ borderTop: "1px solid var(--border)", paddingTop: "0.6rem", fontSize: 12 }}>
              ⚠ {a.error || `${a.hash.slice(0, 16)} — registered, no result published yet`}
            </div>
          ))}
        </div>
      </section>

      <button className="btn-secondary" style={{ fontSize: 12, alignSelf: "flex-start" }} onClick={onBack}>
        ← Back
      </button>
    </div>
  );
}
