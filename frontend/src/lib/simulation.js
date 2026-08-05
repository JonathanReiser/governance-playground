// Rules-based simulation engine — mirrors run-all-experiments.js
//
// applyExperiment() is data-driven: it reads `experiment.effects` from the
// scenario config rather than branching on hardcoded experiment ids. This
// is what lets a second, unrelated scenario (e.g. Taiwan Strait) run
// through the exact same engine as the Middle East scenario it was
// originally written for — see scenarios/*.config.cjs's `effects` field on
// each experiment.
//
// tick()'s ongoing per-cycle logic was ALREADY fully generic (driven only
// by internal state — dealActive / _hardliner — not by any scenario-
// specific string), so it's unchanged.
export class SimulationEngine {
  constructor(scenario) {
    const m = scenario.simulation.metrics;
    this.state = {
      stability:     m.find(x => x.id === "stability_index").startingValue,
      conflicts:     m.find(x => x.id === "conflict_events").startingValue,
      trade:         m.find(x => x.id === "trade_volume").startingValue,
      proxy:         m.find(x => x.id === "proxy_activity").startingValue,
      dealIntegrity: m.find(x => x.id === "deal_integrity").startingValue,
    };
    this.dealActive    = true;
    this._hardliner    = false;
    this.history       = [];
  }

  // `experiment` is a full experiment object from the scenario config
  // (not just its id) — needs the `.effects` field.
  applyExperiment(experiment) {
    const s = this.state;
    const e = experiment?.effects || {};

    const applyField = (key, spec) => {
      if (spec == null) return;
      if ("set" in spec) s[key] = spec.set;
      else if ("delta" in spec) s[key] = s[key] + spec.delta;
    };

    applyField("stability",     e.stability);
    applyField("dealIntegrity", e.dealIntegrity);
    applyField("conflicts",     e.conflicts);
    applyField("proxy",         e.proxy);
    applyField("trade",         e.trade);

    if (e.dealActive === false)  this.dealActive = false;
    if (e.isHardlinerEvent)      this._hardliner = true;

    // Same clamp bounds applyExperiment always used, just applied generically now.
    s.stability     = Math.min(100, Math.max(0, s.stability));
    s.proxy         = Math.min(100, Math.max(0, s.proxy));
    s.trade         = Math.min(500, Math.max(0, s.trade));
    s.dealIntegrity = Math.min(100, Math.max(0, s.dealIntegrity));
    s.conflicts     = Math.max(0, s.conflicts);
  }

  tick(cycleNum) {
    const s = this.state;

    if (this.dealActive) {
      s.dealIntegrity = Math.max(0, s.dealIntegrity - 2);
      if (this._hardliner) {
        s.dealIntegrity = Math.max(0, s.dealIntegrity - 4);
        s.proxy         = Math.min(100, s.proxy + 3);
      }
      if (s.dealIntegrity <= 0) {
        this.dealActive  = false;
        s.dealIntegrity  = 0;
        s.conflicts     += 5;
        s.proxy          = Math.min(100, s.proxy + 15);
        s.stability      = Math.max(0, s.stability - 12);
      } else if (s.dealIntegrity < 20) {
        s.stability  = Math.max(0, s.stability - 3);
        s.conflicts += 1;
        s.proxy      = Math.min(100, s.proxy + 3);
      } else {
        s.stability  = Math.min(100, s.stability + 1);
        s.trade      = Math.min(500, s.trade + 8);
        s.proxy      = Math.max(0,   s.proxy - 1);
        s.conflicts  = Math.max(0,   s.conflicts - 1);
      }
    } else {
      s.dealIntegrity  = 0;
      s.conflicts     += Math.floor(Math.random() * 3) + 2;
      s.proxy          = Math.min(100, s.proxy + 5);
      s.trade          = Math.max(0,   s.trade - 15);
      s.stability      = Math.max(0,   s.stability - 4);
      if (cycleNum % 3 === 0) {
        s.trade      = Math.max(0, s.trade     - 30);
        s.stability  = Math.max(0, s.stability - 5);
        s.conflicts += 3;
      }
    }

    s.stability     = Math.min(100, Math.max(0, Math.round(s.stability)));
    s.conflicts     = Math.max(0,   Math.round(s.conflicts));
    s.trade         = Math.max(0,   Math.round(s.trade));
    s.proxy         = Math.min(100, Math.max(0, Math.round(s.proxy)));
    s.dealIntegrity = Math.min(100, Math.max(0, Math.round(s.dealIntegrity)));

    const snapshot = { cycle: cycleNum, ...s };
    this.history.push(snapshot);
    return snapshot;
  }

  snapshot() { return { ...this.state }; }
}

export function stabilityLabel(score) {
  if (score >= 75) return "Stable";
  if (score >= 50) return "Moderate";
  if (score >= 25) return "Fragile";
  return "Critical";
}

export function stabilityColor(score) {
  if (score >= 75) return "#22c55e";
  if (score >= 50) return "#eab308";
  if (score >= 25) return "#f97316";
  return "#ef4444";
}

// ─────────────────────────────────────────────────────────────
// Generic hypothesis-check evaluator — interprets the declarative
// `experiment.hypothesisChecks` array from a scenario config against a
// completed run, instead of ResultsStep.jsx branching on hardcoded
// experiment ids. See scenarios/*.config.cjs for the check definitions.
// ─────────────────────────────────────────────────────────────
export function evaluateHypothesisChecks(checks, { baseline, expEnd, expHistory }) {
  const results = [];
  for (const check of checks || []) {
    let passed;
    const m = check.metric;
    switch (check.op) {
      case "below":                passed = expEnd[m] < check.value; break;
      case "above":                passed = expEnd[m] > check.value; break;
      case "equals":                passed = expEnd[m] === check.value; break;
      case "belowBaselineMinus":    passed = expEnd[m] < baseline[m] - check.value; break;
      case "aboveBaselinePlus":     passed = expEnd[m] > baseline[m] + check.value; break;
      case "belowPctOfBaseline":    passed = expEnd[m] < baseline[m] * (check.value / 100); break;
      case "cyclesBelow":           passed = expHistory.filter(h => h[m] < check.value).length > 0; break;
      case "aboveWithinFirstNCycles": passed = expHistory.slice(0, check.n).some(h => h[m] > check.value); break;
      case "and":                   passed = (check.refs || []).every(i => results[i]?.passed); break;
      default:                      passed = false;
    }
    results.push({ label: check.label, passed });
  }
  return results;
}
