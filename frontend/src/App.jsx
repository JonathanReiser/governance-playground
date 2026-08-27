import { useState } from "react";
import { ConnectStep }    from "./components/ConnectStep";
import { ScenarioStep }   from "./components/ScenarioStep";
import { DeployStep }     from "./components/DeployStep";
import { ExperimentStep } from "./components/ExperimentStep";
import { AICycleStep }    from "./components/AICycleStep";
import { ResultsStep }    from "./components/ResultsStep";
import { AIResultsStep }  from "./components/AIResultsStep";
import { ViewRunPage }    from "./components/ViewRunPage";
import { BatchResultsPage } from "./components/BatchResultsPage";
import "./App.css";

const STEPS = ["Connect", "Scenario", "Deploy", "Run", "Results"];

export default function App() {
  const [step,       setStep]       = useState(0);
  const [wallet,     setWallet]     = useState(null);
  const [scenario,   setScenario]   = useState(null);
  const [deployment, setDeployment] = useState(null);
  const [results,    setResults]    = useState(null);
  const [mode,       setMode]       = useState(null); // "classic" | "ai"

  // A shareable permalink — ?view=<registryAddress>&block=<deployBlock> —
  // bypasses the whole Connect→Scenario→Deploy flow entirely and just
  // reads that run's real state straight from Sepolia. Read once at
  // mount (not on every render): this app has no client-side router, so
  // leaving the view is a real navigation (see ViewRunPage's onBack),
  // not a state change. `block` is optional — see onchainLogs.js and
  // ViewRunPage's own comments for what it's for and what happens
  // without it (an older link, from before this param existed).
  const [viewParams] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const registryAddress = params.get("view");
    const blockParam = params.get("block");
    const deployBlock = blockParam !== null && /^\d+$/.test(blockParam) ? Number(blockParam) : null;
    // ?batch=<registrationHash> — see BatchResultsPage.jsx's own comment on
    // why this is a separate param from ?view rather than one page handling
    // both: a batch has no on-chain address to key off of at all.
    const batchHash = params.get("batch");
    return { registryAddress, deployBlock, batchHash };
  });

  if (viewParams.batchHash) {
    return (
      <div className="app">
        <header className="app-header">
          <div className="header-inner">
            <div className="logo">
              <span className="logo-icon">⬡</span>
              <span className="logo-text">Governance Playground</span>
            </div>
          </div>
        </header>
        <main className="app-main">
          <BatchResultsPage
            hashPrefix={viewParams.batchHash}
            onBack={() => { window.location.href = window.location.pathname; }}
          />
        </main>
      </div>
    );
  }

  if (viewParams.registryAddress) {
    return (
      <div className="app">
        <header className="app-header">
          <div className="header-inner">
            <div className="logo">
              <span className="logo-icon">⬡</span>
              <span className="logo-text">Governance Playground</span>
            </div>
          </div>
        </header>
        <main className="app-main">
          <ViewRunPage
            registryAddress={viewParams.registryAddress}
            deployBlock={viewParams.deployBlock}
            onBack={() => { window.location.href = window.location.pathname; }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">⬡</span>
            <span className="logo-text">Governance Playground</span>
            {wallet?.networkName && (
              <span className={`network-badge ${wallet.networkName === "Sepolia" ? "network-badge--live" : ""}`}>
                {wallet.networkName}
              </span>
            )}
          </div>
          <nav className="stepper">
            {STEPS.map((s, i) => (
              <div key={s} className={`step ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}>
                <span className="step-num">{i < step ? "✓" : i + 1}</span>
                <span className="step-label">{s}</span>
              </div>
            ))}
          </nav>
        </div>
      </header>

      <main className="app-main">
        {step === 0 && <ConnectStep onConnect={(w) => { setWallet(w); setStep(1); }} />}
        {step === 1 && <ScenarioStep onLoad={(s) => { setScenario(s); setStep(2); }} />}
        {step === 2 && (
          <DeployStep
            signer={wallet.signer}
            networkName={wallet.networkName}
            scenario={scenario}
            onDeployed={(d) => { setDeployment(d); setStep(3); }}
          />
        )}
        {step === 3 && !mode && (
          <div className="step-panel center-panel">
            <div className="panel-header">
              <h2>Choose Mode</h2>
              <p className="muted">Run a fixed experiment, or let Claude-powered nation agents decide each cycle.</p>
            </div>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
              <button className="exp-card" style={{ maxWidth: 320 }} onClick={() => setMode("classic")}>
                <div className="exp-card-name">Classic Experiments</div>
                <div className="exp-card-question muted">Apply a pre-built scenario change and observe fixed-rule simulation outcomes.</div>
              </button>
              <button
                className="exp-card"
                style={{ maxWidth: 320, opacity: scenario.meta.aiModeSupported ? 1 : 0.5, cursor: scenario.meta.aiModeSupported ? "pointer" : "not-allowed" }}
                onClick={() => scenario.meta.aiModeSupported && setMode("ai")}
                disabled={!scenario.meta.aiModeSupported}
              >
                <div className="exp-card-name">AI Agent Cycle ✦</div>
                <div className="exp-card-question muted">
                  {scenario.meta.aiModeSupported
                    ? `${scenario.nations.map(n => n.name).join(", ")} reason through each cycle using political science frameworks. Review and edit before committing on-chain.`
                    : `Not yet available for ${scenario.meta.name} — the AI agent layer's system prompts and quantum uncertainty model haven't been built for this scenario yet. Use Classic Experiments for this scenario.`}
                </div>
              </button>
            </div>
          </div>
        )}
        {step === 3 && mode === "classic" && (
          <ExperimentStep
            signer={wallet.signer}
            scenario={scenario}
            deployment={deployment}
            onResults={(r) => { setResults(r); setStep(4); }}
          />
        )}
        {step === 3 && mode === "ai" && (
          <AICycleStep
            signer={wallet.signer}
            scenario={scenario}
            deployment={deployment}
            onResults={(r) => { setResults(r); setStep(4); }}
          />
        )}
        {step === 4 && mode === "classic" && (
          <ResultsStep
            results={results}
            onReset={() => { setResults(null); setStep(3); }}
          />
        )}
        {step === 4 && mode === "ai" && (
          <AIResultsStep
            results={results}
            scenario={scenario}
            onReset={() => { setResults(null); setStep(3); }}
          />
        )}
      </main>
    </div>
  );
}
