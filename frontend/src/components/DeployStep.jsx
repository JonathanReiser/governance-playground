import { useState } from "react";
import { deployScenario } from "../lib/contracts";

const GOV_LABELS = {
  PARLIAMENTARY_DEMOCRACY: "Parliamentary Democracy",
  THEOCRATIC_REPUBLIC:     "Theocratic Republic",
  ABSOLUTE_MONARCHY:       "Absolute Monarchy",
  FEDERAL_REPUBLIC:        "Federal Republic",
  MILITARY_JUNTA:          "Military Junta",
};

function govDescription(nation) {
  const base = GOV_LABELS[nation.governance.type] || nation.governance.type;
  if (nation.governance.guardianVeto) return `${base} (Guardian Council veto)`;
  if (nation.governance.royalVeto)    return `${base} (Royal veto)`;
  return base;
}

export function DeployStep({ signer, scenario, networkName, onDeployed }) {
  const targetLabel = networkName || "your local Hardhat network";
  const [log,      setLog]      = useState([]);
  const [deploying, setDeploying] = useState(false);
  const [done,     setDone]     = useState(false);
  const [error,    setError]    = useState("");
  const [addrs,    setAddrs]    = useState(null);

  function append(msg) {
    setLog(prev => [...prev, { ts: new Date().toLocaleTimeString(), msg }]);
  }

  async function handleDeploy() {
    setDeploying(true);
    setError("");
    setLog([]);
    try {
      const result = await deployScenario(signer, scenario, append);
      setAddrs({ registry: result.registryAddress, oracle: result.oracleAddress });
      setDone(true);
      onDeployed(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setDeploying(false);
    }
  }

  return (
    <div className="step-panel">
      <div className="panel-header">
        <h2>Deploy Scenario</h2>
        <p className="muted">
          Deploys WorldRegistry, MetricsOracle, and all three nation DAOs to {targetLabel}.
          This creates the on-chain record that all experiment results will be written to.
        </p>
      </div>

      <div className="deploy-overview">
        <div className="deploy-item"><span className="deploy-icon">📋</span><span>WorldRegistry — simulation controller</span></div>
        <div className="deploy-item"><span className="deploy-icon">📊</span><span>MetricsOracle — measurement engine</span></div>
        {scenario.nations.map(n => (
          <div key={n.id} className="deploy-item">
            <span className="deploy-icon">{n.flag}</span>
            <span>{n.name} — {govDescription(n)}</span>
          </div>
        ))}
        <div className="deploy-item">
          <span className="deploy-icon">🤝</span>
          <span>{scenario.relationships.length} relationships + {scenario.activeEvents.length} global events</span>
        </div>
      </div>

      {log.length > 0 && (
        <div className="deploy-log">
          {log.map((l, i) => (
            <div key={i} className="log-line">
              <span className="log-ts">{l.ts}</span>
              <span>{l.msg}</span>
            </div>
          ))}
          {deploying && <div className="log-line log-pulse">⟳ working…</div>}
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      {addrs && (
        <div className="addr-block">
          <div className="addr-row">
            <span className="addr-label">WorldRegistry</span>
            <code className="addr-val">{addrs.registry}</code>
          </div>
          <div className="addr-row">
            <span className="addr-label">MetricsOracle</span>
            <code className="addr-val">{addrs.oracle}</code>
          </div>
        </div>
      )}

      <div className="step-footer">
        {!done ? (
          <button className="btn-primary" onClick={handleDeploy} disabled={deploying}>
            {deploying ? "Deploying…" : `Deploy to ${networkName || "Hardhat"}`}
          </button>
        ) : (
          <div className="success-msg">
            ✓ Scenario deployed. All on-chain. Proceeding to experiments…
          </div>
        )}
      </div>
    </div>
  );
}
