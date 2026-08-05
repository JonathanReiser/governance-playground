import { useState } from "react";
import { deployScenario } from "../lib/contracts";

export function DeployStep({ signer, scenario, onDeployed }) {
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
          Deploys WorldRegistry, MetricsOracle, and all three nation DAOs to your local Hardhat network.
          This creates the on-chain record that all experiment results will be written to.
        </p>
      </div>

      <div className="deploy-overview">
        <div className="deploy-item"><span className="deploy-icon">📋</span><span>WorldRegistry — simulation controller</span></div>
        <div className="deploy-item"><span className="deploy-icon">📊</span><span>MetricsOracle — measurement engine</span></div>
        <div className="deploy-item"><span className="deploy-icon">🇮🇱</span><span>Israel — Parliamentary Democracy</span></div>
        <div className="deploy-item"><span className="deploy-icon">🇮🇷</span><span>Iran — Theocratic Republic (Guardian Council veto)</span></div>
        <div className="deploy-item"><span className="deploy-icon">🇸🇦</span><span>Saudi Arabia — Absolute Monarchy (Royal veto)</span></div>
        <div className="deploy-item"><span className="deploy-icon">🤝</span><span>3 relationships + 2 global events</span></div>
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
            {deploying ? "Deploying…" : "Deploy to Hardhat"}
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
