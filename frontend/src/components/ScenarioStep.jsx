import { useState } from "react";
import MIDDLE_EAST_2026 from "../scenarios/middle-east-2026.json";
import TAIWAN_STRAIT_2026 from "../scenarios/taiwan-strait-2026.json";

// Both scenarios are generated 1:1 from the canonical CLI source of truth
// (scenarios/*.config.cjs → frontend/src/scenarios/*.json) — see
// scripts in the repo root. No hand-duplicated data here anymore.
const SCENARIOS = [MIDDLE_EAST_2026, TAIWAN_STRAIT_2026];

const GOV_LABELS = {
  PARLIAMENTARY_DEMOCRACY: "Parliamentary Democracy",
  THEOCRATIC_REPUBLIC:     "Theocratic Republic",
  ABSOLUTE_MONARCHY:       "Absolute Monarchy",
  FEDERAL_REPUBLIC:        "Federal Republic",
  MILITARY_JUNTA:          "Military Junta",
};

const REL_LABELS = {
  ALLIED: "Allied", PARTNER: "Partner", NEUTRAL: "Neutral",
  FRAGILE_PEACE: "Fragile Peace", COLD: "Cold",
  SANCTIONED: "Sanctioned", HOSTILE: "Hostile",
};

const REL_COLORS = {
  ALLIED: "#22c55e", PARTNER: "#84cc16", NEUTRAL: "#6b7280",
  FRAGILE_PEACE: "#eab308", COLD: "#f97316",
  SANCTIONED: "#ef4444", HOSTILE: "#dc2626",
};

function NationCard({ nation }) {
  // Different nations lean on different pressure fields depending on their
  // governance structure (hardlinerPressure for Iran/China-style systems,
  // reformPressure for Saudi/Japan-style hedging ones) — show whichever
  // the nation actually has instead of assuming one specific field exists.
  const pressureLabel = nation.governance.hardlinerPressure != null ? "Hardliner"
                       : nation.governance.reformPressure   != null ? "Reform" : null;
  const pressureValue = nation.governance.hardlinerPressure ?? nation.governance.reformPressure;

  return (
    <div className="nation-card">
      <div className="nation-header">
        <span className="nation-flag">{nation.flag}</span>
        <div>
          <div className="nation-name">{nation.name}</div>
          <div className="nation-gov">{GOV_LABELS[nation.governance.type] || nation.governance.type}</div>
        </div>
      </div>
      <div className="nation-stats">
        <div className="stat">
          <span className="stat-label">Military</span>
          <span className="stat-value">{nation.military.power}/100</span>
        </div>
        <div className="stat">
          <span className="stat-label">Treasury</span>
          <span className="stat-value">{nation.economy.treasury}</span>
        </div>
        {pressureLabel && (
          <div className="stat">
            <span className="stat-label">{pressureLabel}</span>
            <span className="stat-value">{pressureValue}%</span>
          </div>
        )}
        <div className="stat">
          <span className="stat-label">Guardian Veto</span>
          <span className="stat-value">{nation.governance.guardianVeto ? "Yes" : "No"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Royal Veto</span>
          <span className="stat-value">{nation.governance.royalVeto ? "Yes" : "No"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Sanctioned</span>
          <span className="stat-value">{nation.economy.sanctioned ? "Yes" : "No"}</span>
        </div>
      </div>
    </div>
  );
}

export function ScenarioStep({ onLoad }) {
  const [scenario, setScenario] = useState(null);

  if (!scenario) {
    return (
      <div className="step-panel">
        <div className="panel-header">
          <h2>Choose a Scenario</h2>
          <p className="muted">Every scenario runs on the same generic contracts — no new contracts required.</p>
        </div>
        <div className="exp-grid">
          {SCENARIOS.map(s => (
            <button key={s.meta.name} className="exp-card" onClick={() => setScenario(s)}>
              <div className="exp-card-name">{s.meta.name}</div>
              <div className="exp-card-question muted">{s.meta.description}</div>
              <div className="tag-row" style={{ marginTop: "0.5rem" }}>
                {s.meta.tags.map(t => <span key={t} className="tag">{t}</span>)}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="step-panel">
      <div className="panel-header">
        <h2>Scenario: {scenario.meta.name}</h2>
        <p className="muted">{scenario.meta.description}</p>
        <div className="tag-row">
          {scenario.meta.tags.map(t => <span key={t} className="tag">{t}</span>)}
        </div>
      </div>

      <section className="section">
        <h3>Nations ({scenario.nations.length})</h3>
        <div className="nation-grid">
          {scenario.nations.map(n => <NationCard key={n.id} nation={n} />)}
        </div>
      </section>

      <section className="section">
        <h3>Relationships</h3>
        <div className="rel-table">
          {scenario.relationships.map(r => (
            <div key={r.from + r.to} className="rel-row">
              <span className="rel-nations">{r.from} ↔ {r.to}</span>
              <span className="rel-type" style={{ color: REL_COLORS[r.type] }}>{REL_LABELS[r.type]}</span>
              <span className="rel-score">Stability: {r.stabilityScore}/100</span>
              {r.treatyActive && <span className="rel-treaty">Treaty: {r.treatyName}</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h3>Starting Metrics</h3>
        <div className="metric-row">
          {scenario.simulation.metrics.map(m => (
            <div key={m.id} className="metric-chip">
              <span className="metric-label">{m.name}</span>
              <span className="metric-value">{m.startingValue}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h3>Pre-built Experiments ({scenario.experiments.length})</h3>
        <div className="exp-preview-list">
          {scenario.experiments.map(e => (
            <div key={e.id} className="exp-preview">
              <strong>{e.name}</strong>
              <span className="muted">{e.question}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="step-footer">
        <button className="btn-secondary" onClick={() => setScenario(null)}>
          ← Choose a Different Scenario
        </button>
        <button className="btn-primary" onClick={() => onLoad(scenario)}>
          Load Scenario → Deploy
        </button>
      </div>
    </div>
  );
}
