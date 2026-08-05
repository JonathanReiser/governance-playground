import { useState } from "react";

// Inline the scenario — in a real app this would be a dynamic import or fetch
// We can't import a .cjs directly from Vite, so we embed the relevant data.
// The full config lives in scenarios/middle-east-2026.config.cjs
const MIDDLE_EAST_2026 = {
  meta: {
    name: "Middle East — May 2026",
    version: "1.0.0",
    description:
      "Post-war scenario following the US/Israel-Iran peace deal. " +
      "Iran has agreed to cap nuclear enrichment and reopen the Hormuz Strait. " +
      "The US has lifted partial sanctions. Regional stability is fragile.",
    tags: ["middle-east", "peace-deal", "nuclear", "hormuz", "2026"],
  },
  nations: [
    {
      id: "israel",
      name: "Israel",
      flag: "🇮🇱",
      governance: {
        type: "PARLIAMENTARY_DEMOCRACY",
        votingMechanism: "ONE_TOKEN_ONE_VOTE",
        proposalThreshold: 100,
        quorum: 40,
        guardianVeto: false,
        royalVeto: false,
        hardlinerPressure: 45,
        reformPressure: 55,
      },
      economy: { gdp: 520, treasury: 8500, sanctioned: false, tradeOpenness: "HIGH" },
      military: { power: 850, proxyForces: false, proxyCapacity: 0, nuclearCapacity: true },
      population: { sentiment: 58 },
    },
    {
      id: "iran",
      name: "Iran",
      flag: "🇮🇷",
      governance: {
        type: "THEOCRATIC_REPUBLIC",
        votingMechanism: "DUAL_LAYER",
        proposalThreshold: 500,
        quorum: 60,
        guardianVeto: true,
        royalVeto: false,
        hardlinerPressure: 72,
        reformPressure: 28,
      },
      economy: { gdp: 231, treasury: 4200, sanctioned: true, sanctionsReliefPending: true, tradeOpenness: "LOW" },
      military: { power: 620, proxyForces: true, proxyCapacity: 85, nuclearCapacity: false, nuclearDealActive: true },
      resources: { oil: 80, hormuzControl: true, hormuzOpen: true },
      population: { sentiment: 29 },
    },
    {
      id: "saudi_arabia",
      name: "Saudi Arabia",
      flag: "🇸🇦",
      governance: {
        type: "ABSOLUTE_MONARCHY",
        votingMechanism: "COUNCIL_WEIGHTED",
        proposalThreshold: 1000,
        quorum: 75,
        guardianVeto: false,
        royalVeto: true,
        hardlinerPressure: 38,
        reformPressure: 62,
      },
      economy: { gdp: 1100, treasury: 18000, sanctioned: false, tradeOpenness: "HIGH" },
      military: { power: 720, proxyForces: false, proxyCapacity: 0, nuclearCapacity: false },
      resources: { oil: 90 },
      population: { sentiment: 62 },
    },
  ],
  relationships: [
    { from: "israel", to: "iran",         type: "FRAGILE_PEACE", stabilityScore: 28, treatyActive: true,  treatyName: "Hormuz Nuclear Agreement" },
    { from: "israel", to: "saudi_arabia", type: "COLD",          stabilityScore: 42, treatyActive: false, treatyName: "" },
    { from: "iran",   to: "saudi_arabia", type: "COLD",          stabilityScore: 35, treatyActive: false, treatyName: "" },
  ],
  activeEvents: [
    {
      id: "hormuz_nuclear_deal",
      name: "Hormuz Nuclear Agreement",
      type: "PEACE_DEAL",
      parties: ["israel", "iran"],
      description: "Framework agreement capping Iranian enrichment at 20% and reopening Hormuz to international shipping.",
    },
    {
      id: "hormuz_strait_control",
      name: "Hormuz Strait — Iranian Control",
      type: "RESOURCE_EVENT",
      parties: ["iran", "saudi_arabia"],
      description: "Iran retains effective control over Hormuz Strait, representing 20% of global oil trade.",
    },
  ],
  simulation: {
    defaultCycles: 20,
    metrics: [
      { id: "stability_index",  label: "Stability Index",  startingValue: 48,  unit: "/100" },
      { id: "conflict_events",  label: "Conflict Events",  startingValue: 0,   unit: "" },
      { id: "trade_volume",     label: "Trade Volume",     startingValue: 200, unit: "" },
      { id: "proxy_activity",   label: "Proxy Activity",   startingValue: 35,  unit: "/100" },
      { id: "deal_integrity",   label: "Deal Integrity",   startingValue: 32,  unit: "/100" },
    ],
  },
  experiments: [
    {
      id: "exp_deal_collapse",
      name: "The Deal Collapses",
      question: "What happens if the peace deal collapses in cycle 1?",
      change: { target: "activeEvents.hormuz_nuclear_deal.status", from: "ACTIVE_FRAGILE", to: "COLLAPSED" },
      hypothesis: "Iran closes Hormuz within 3 cycles. Oil prices spike. Stability index drops below 20.",
    },
    {
      id: "exp_congress_blocks",
      name: "US Congress Blocks Sanctions Relief",
      question: "What if the US fails to deliver on its sanctions promise?",
      change: { target: "nations.iran.economy.sanctionsReliefPending", from: true, to: false },
      hypothesis: "Iran's hardliner pressure increases. Deal integrity drops. Proxy activity resumes within 5 cycles.",
    },
    {
      id: "exp_saudi_normalizes",
      name: "Saudi Arabia Normalizes with Israel",
      question: "What if Saudi Arabia formally recognizes Israel?",
      change: { target: "relationships.israel_saudi.type", from: "COLD", to: "PARTNER" },
      hypothesis: "Regional trade increases significantly. Iran feels encircled — hardliner pressure rises.",
    },
    {
      id: "exp_hardliners_win",
      name: "Iranian Hardliners Gain Power",
      question: "What if hardliners replace moderates in Iran's government?",
      change: { target: "nations.iran.governance.hardlinerPressure", from: 72, to: 95 },
      hypothesis: "Iran exits the nuclear deal. Hormuz threatened within 4 cycles. Proxy activity surges to maximum.",
    },
  ],
};

const GOV_LABELS = {
  PARLIAMENTARY_DEMOCRACY: "Parliamentary Democracy",
  THEOCRATIC_REPUBLIC:     "Theocratic Republic",
  ABSOLUTE_MONARCHY:       "Absolute Monarchy",
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
  return (
    <div className="nation-card">
      <div className="nation-header">
        <span className="nation-flag">{nation.flag}</span>
        <div>
          <div className="nation-name">{nation.name}</div>
          <div className="nation-gov">{GOV_LABELS[nation.governance.type]}</div>
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
        <div className="stat">
          <span className="stat-label">Hardliner</span>
          <span className="stat-value">{nation.governance.hardlinerPressure}%</span>
        </div>
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
  const [loaded, setLoaded] = useState(false);
  const scenario = MIDDLE_EAST_2026;

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
              <span className="metric-label">{m.label}</span>
              <span className="metric-value">{m.startingValue}{m.unit}</span>
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
        <button className="btn-primary" onClick={() => onLoad(scenario)}>
          Load Scenario → Deploy
        </button>
      </div>
    </div>
  );
}
