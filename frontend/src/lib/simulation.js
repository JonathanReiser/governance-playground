// Rules-based simulation engine — mirrors run-all-experiments.js
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

  applyExperiment(id) {
    const s = this.state;
    if (id === "exp_deal_collapse") {
      this.dealActive    = false;
      s.stability        = Math.max(0, s.stability - 18);
      s.dealIntegrity    = 0;
      s.conflicts       += 4;
      s.proxy           += 20;
    }
    if (id === "exp_congress_blocks") {
      s.dealIntegrity    = Math.max(0, s.dealIntegrity - 25);
      s.proxy            = Math.min(100, s.proxy + 10);
    }
    if (id === "exp_saudi_normalizes") {
      s.trade            = Math.min(500, s.trade + 200);
      s.stability        = Math.min(100, s.stability + 12);
      s.proxy            = Math.min(100, s.proxy + 8);
    }
    if (id === "exp_hardliners_win") {
      s.dealIntegrity    = Math.max(0, s.dealIntegrity - 35);
      s.proxy            = Math.min(100, s.proxy + 25);
      s.stability        = Math.max(0, s.stability - 10);
      this._hardliner    = true;
    }
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
