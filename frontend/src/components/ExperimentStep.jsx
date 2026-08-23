import { useState } from "react";
import { SimulationEngine } from "../lib/simulation";
import { deployScenario, EventStatus } from "../lib/contracts";

const CYCLES = 10;

export function ExperimentStep({ signer, scenario, onResults }) {
  const [selected, setSelected]   = useState(null);
  const [phase,    setPhase]      = useState("idle"); // idle | baseline | experiment | done
  const [baseLog,  setBaseLog]    = useState([]);
  const [expLog,   setExpLog]     = useState([]);
  const [error,    setError]      = useState("");

  function appendBase(entry) { setBaseLog(prev => [...prev, entry]); }
  function appendExp(entry)  { setExpLog(prev => [...prev, entry]); }

  async function run() {
    if (!selected) return;
    setError("");
    setBaseLog([]);
    setExpLog([]);

    try {
      // ── BASELINE ─────────────────────────────────────────
      setPhase("baseline");

      const base  = await deployScenario(signer, scenario, () => {});
      const baseEngine = new SimulationEngine(scenario);
      const baseStart  = baseEngine.snapshot();

      await base.oracle.updateMetrics(
        BigInt(baseStart.stability), BigInt(baseStart.conflicts),
        BigInt(baseStart.trade),     BigInt(baseStart.proxy),
        BigInt(baseStart.dealIntegrity)
      );
      await base.registry.advanceCycle();
      await base.oracle.setBaseline(1);

      for (let i = 1; i <= CYCLES; i++) {
        const m = baseEngine.tick(i);
        await base.oracle.updateMetrics(
          BigInt(m.stability), BigInt(m.conflicts),
          BigInt(m.trade),     BigInt(m.proxy),
          BigInt(m.dealIntegrity)
        );
        await base.registry.advanceCycle();
        appendBase({ cycle: i, ...m });
      }
      const baseline = baseEngine.snapshot();
      const baseHistory = [...baseEngine.history];

      // ── EXPERIMENT ───────────────────────────────────────
      setPhase("experiment");

      // Fresh deploy for the experiment run
      const fresh = await deployScenario(signer, scenario, () => {});

      const expEngine = new SimulationEngine(scenario);
      expEngine.applyExperiment(selected);

      await fresh.oracle.recordExperiment(
        selected.id, "global", selected.change.target, BigInt(0), BigInt(0)
      );

      // Generic: any experiment whose change targets an active event's
      // status (e.g. "activeEvents.hormuz_nuclear_deal.status", or Taiwan
      // Strait's "activeEvents.cross_strait_status_quo.status") gets that
      // status change written on-chain too — not just one hardcoded event.
      const eventStatusMatch = selected.change.target.match(/^activeEvents\.([^.]+)\.status$/);
      if (eventStatusMatch) {
        const newStatus = EventStatus[selected.change.to];
        if (newStatus !== undefined) {
          await fresh.registry.updateEventStatus(eventStatusMatch[1], newStatus);
        }
      }

      await fresh.oracle.updateMetrics(
        BigInt(expEngine.snapshot().stability), BigInt(expEngine.snapshot().conflicts),
        BigInt(expEngine.snapshot().trade),     BigInt(expEngine.snapshot().proxy),
        BigInt(expEngine.snapshot().dealIntegrity)
      );
      await fresh.registry.advanceCycle();
      await fresh.oracle.setBaseline(1);

      for (let i = 1; i <= CYCLES; i++) {
        const m = expEngine.tick(i);
        await fresh.oracle.updateMetrics(
          BigInt(m.stability), BigInt(m.conflicts),
          BigInt(m.trade),     BigInt(m.proxy),
          BigInt(m.dealIntegrity)
        );
        await fresh.registry.advanceCycle();
        appendExp({ cycle: i, ...m });
      }
      const expEnd     = expEngine.snapshot();
      const expHistory = [...expEngine.history];

      setPhase("done");
      onResults({
        experiment:  selected,
        baseline,
        expEnd,
        baseHistory,
        expHistory,
        baseRegistryAddr: base.registryAddress,
        baseOracleAddr:   base.oracleAddress,
        expRegistryAddr:  fresh.registryAddress,
        expOracleAddr:    fresh.oracleAddress,
        cycles: CYCLES,
      });
    } catch (e) {
      setError(e.message);
      setPhase("idle");
    }
  }

  return (
    <div className="step-panel">
      <div className="panel-header">
        <h2>Select & Run Experiment</h2>
        <p className="muted">
          Pick one experiment. The runner will first establish a baseline (no change), then apply
          your change and run the same number of cycles. Every metric is written to the blockchain.
        </p>
      </div>

      <div className="exp-grid">
        {scenario.experiments.map(exp => (
          <button
            key={exp.id}
            className={`exp-card ${selected?.id === exp.id ? "selected" : ""}`}
            onClick={() => phase === "idle" && setSelected(exp)}
            disabled={phase !== "idle"}
          >
            <div className="exp-card-name">{exp.name}</div>
            <div className="exp-card-question muted">{exp.question}</div>
            <div className="exp-card-hypothesis">
              <em>H: {exp.hypothesis}</em>
            </div>
            <div className="exp-card-change">
              <code>{exp.change.target}</code>
              <span className="arrow">→</span>
              <code>{String(exp.change.to)}</code>
            </div>
          </button>
        ))}
      </div>

      {error && <div className="error-box">{error}</div>}

      {(baseLog.length > 0 || expLog.length > 0) && (
        <div className="live-feed">
          <div className="feed-col">
            <div className="feed-header">
              Baseline {phase === "baseline" && <span className="pulse">●</span>}
            </div>
            <div className="feed-rows">
              {baseLog.map(r => (
                <div key={r.cycle} className="feed-row">
                  <span className="feed-cycle">C{r.cycle}</span>
                  <span className="feed-bar">
                    <span className="feed-fill" style={{ width: `${r.stability}%` }} />
                  </span>
                  <span className="feed-val">{r.stability}/100</span>
                </div>
              ))}
            </div>
          </div>
          <div className="feed-col">
            <div className="feed-header">
              Experiment {phase === "experiment" && <span className="pulse">●</span>}
            </div>
            <div className="feed-rows">
              {expLog.map(r => (
                <div key={r.cycle} className="feed-row">
                  <span className="feed-cycle">C{r.cycle}</span>
                  <span className="feed-bar">
                    <span
                      className="feed-fill"
                      style={{
                        width: `${r.stability}%`,
                        background: r.stability < 25 ? "#ef4444" : r.stability < 50 ? "#f97316" : "#22c55e",
                      }}
                    />
                  </span>
                  <span className="feed-val">{r.stability}/100</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="step-footer">
        <button
          className="btn-primary"
          onClick={run}
          disabled={!selected || phase !== "idle"}
        >
          {phase === "idle"       ? "Run Experiment"       : ""}
          {phase === "baseline"   ? "Running baseline…"   : ""}
          {phase === "experiment" ? "Running experiment…" : ""}
          {phase === "done"       ? "Complete — loading results…" : ""}
        </button>
        {!selected && <span className="muted" style={{ marginLeft: "1rem" }}>Select an experiment above</span>}
      </div>
    </div>
  );
}
