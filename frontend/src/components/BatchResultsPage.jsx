import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer,
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

/**
 * A shareable permalink for one batch experiment: `?batch=<registrationHash>`.
 * Read-only, same as ViewRunPage.jsx — but unlike that page, this one is
 * NOT independent of this app's own uptime: there's no public chain a
 * batch's data lives on (see README's batch-mode section for why that's a
 * deliberate cost/complexity tradeoff, not an oversight), so this reads
 * straight from preregistrations/*.json bundled into this deployment (see
 * server.js's GET /api/batch/:hashPrefix and vercel.json's `includeFiles`).
 * That's the honest asymmetry: a single run's `?view=` link outlives this
 * site; a batch's `?batch=` link doesn't, unless the underlying JSON files
 * are mirrored somewhere else too.
 *
 * Also unlike a single run, this page can't offer "watch it play out" at
 * all — a real batch is dozens to hundreds of real cycles, hours of real
 * wall-clock time (see scripts/run-batch.js), nothing a browser tab could
 * run inline. This page only ever shows a batch that already finished
 * running, via `node scripts/run-batch.js` + `draw-batch`, not one anybody
 * can start from here.
 */
export function BatchResultsPage({ hashPrefix, onBack }) {
  const [state, setState] = useState({ status: "loading" });
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // see ViewRunPage.jsx's identical copyLink for why this never blocks sharing
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/batch/${hashPrefix}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) return setState({ status: "error", error: data.error || "Batch not found" });
        // Computed once, at load time, rather than read from Date.now() in
        // the render body (React's purity rules disallow the latter) — this
        // only ever needs to reflect "as of when this page loaded" anyway.
        const overdue = !data.result && Date.now() > Date.parse(data.registration.drawAfter);
        setState({ status: "ready", ...data, overdue });
      } catch (err) {
        if (!cancelled) setState({ status: "error", error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [hashPrefix]);

  if (state.status === "loading") {
    return (
      <div className="step-panel center-panel">
        <div className="connect-card" style={{ maxWidth: 480, margin: "0 auto" }}>
          <p className="muted">Loading batch {hashPrefix}…</p>
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

  const { registration, result, report, overdue } = state;
  const finalStabilities = result ? result.trials.map((t) => finalStabilityOf(t)).filter((v) => v != null) : [];
  const chartData = result
    ? result.trials.map((t) => ({ trial: `#${t.trialIndex + 1}`, stability: finalStabilityOf(t) }))
    : [];

  return (
    <div className="step-panel">
      <div className="panel-header">
        <h2>Batch Experiment</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          {registration.trialCount} independent trials of {registration.cyclesPerTrial} cycles each — a
          distribution, not one run's single outcome. See{" "}
          <a href="https://github.com/JonathanReiser/governance-playground#pre-registration" target="_blank" rel="noopener noreferrer">
            the README's pre-registration section
          </a>{" "}
          for what this mechanism proves and what it doesn't.
        </p>
      </div>

      <div className="chart-wrap">
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", opacity: 0.7, marginBottom: "0.4rem" }}>
          Hypothesis (registered before any trial ran)
        </div>
        <div style={{ fontSize: 14, marginBottom: "0.75rem" }}>{registration.hypothesis}</div>
        <div className="muted" style={{ fontSize: 12, fontFamily: "monospace" }}>
          {registration.scenarioId}
          {registration.startingConditionIds.length > 0
            ? ` — ${registration.startingConditionIds.join(", ")}`
            : " — as researched (default)"}
          {" · "}model {registration.agentModel} ({registration.agentEffort})
          {" · "}registered {registration.createdAt}
        </div>
      </div>

      {!result && (
        <div className={overdue ? "error-box" : "chart-wrap"}>
          {overdue
            ? `⚠ Registered ${registration.createdAt}, draw was due ${registration.drawAfter} — no result has been published. That's not a display error, it's the finding: a promised batch that never appeared is exactly what this mechanism exists to surface.`
            : `⏳ Draw scheduled for ${registration.drawAfter} — not reached yet.`}
        </div>
      )}

      {result && (
        <>
          <section className="section">
            <h3>Final Regional Stability — {result.trials.length} trials</h3>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                  <XAxis dataKey="trial" stroke={AXIS_STROKE} />
                  <YAxis domain={[0, 100]} stroke={AXIS_STROKE} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
                  <Bar dataKey="stability" isAnimationActive={false}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={stabilityColor(d.stability)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {finalStabilities.length > 0 && (
              <div className="muted" style={{ fontSize: 12, marginTop: "0.5rem" }}>
                median {median(finalStabilities).toFixed(0)} · mean{" "}
                {(finalStabilities.reduce((a, b) => a + b, 0) / finalStabilities.length).toFixed(1)} · min{" "}
                {Math.min(...finalStabilities)} · max {Math.max(...finalStabilities)}
              </div>
            )}
          </section>

          <section className="section">
            <h3>Verification</h3>
            <div className="chart-wrap">
              {report.checks.map((c) => (
                <div key={c.name} style={{ fontSize: 12, marginBottom: "0.4rem" }}>
                  {c.ok ? "✅" : "❌"} <strong>{c.name}</strong>
                  <div className="muted" style={{ marginLeft: "1.3rem" }}>{c.detail}</div>
                </div>
              ))}
              <div style={{ marginTop: "0.5rem", fontWeight: 600, color: report.ok ? "#22c55e" : "#ef4444" }}>
                {report.ok ? "✅ all checks passed" : "❌ verification FAILED"}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: "0.5rem" }}>
                <strong>Proves:</strong> {report.proves}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: "0.25rem" }}>
                <strong>Does not prove:</strong> {report.doesNotProve}
              </div>
            </div>
          </section>
        </>
      )}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button className="btn-secondary" style={{ fontSize: 12 }} onClick={copyLink}>
          {copied ? "✓ Copied" : "📋 Copy Link"}
        </button>
        <button className="btn-secondary" style={{ fontSize: 12 }} onClick={onBack}>
          ← Back
        </button>
      </div>
    </div>
  );
}
