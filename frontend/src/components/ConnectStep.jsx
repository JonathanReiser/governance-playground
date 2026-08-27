import { useState } from "react";
import { connectWallet, connectDirect, switchToSepolia } from "../lib/contracts";
import { LiveDemoPanel } from "./LiveDemoPanel";
import { LiveRunPanel } from "./LiveRunPanel";
import { listRuns, removeRun, viewUrlFor, getContinuation } from "../lib/runHistory";
import { SCENARIOS } from "../lib/scenarios";

export function ConnectStep({ onConnect }) {
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(null); // "direct" | "metamask" | "switching" | null
  const [showLiveDemo, setShowLiveDemo] = useState(false);
  const [showMyRuns, setShowMyRuns] = useState(false);
  const [myRuns, setMyRuns] = useState(() => listRuns());
  // Set when a visitor clicks "Continue" on a saved run — holds exactly
  // what LiveRunPanel needs to pick up from there: which run, and the
  // quantum/market checkpoint this browser saved the last time cycles
  // ran on it (see runHistory.js's saveContinuation/getContinuation and
  // LiveRunPanel.jsx's `initialCheckpoint` prop / header comment for why
  // this can only ever work on the browser that ran it).
  const [continuingRun, setContinuingRun] = useState(null); // { run, continuation } | null

  async function handle(mode) {
    setError("");
    setLoading(mode);
    try {
      const wallet = mode === "direct" ? await connectDirect() : await connectWallet();
      onConnect(wallet);
    } catch (e) {
      // Keep the unsupportedNetwork flag intact so the UI can offer a
      // one-click Sepolia switch instead of just failing.
      setError(e);
    } finally {
      setLoading(null);
    }
  }

  async function handleSwitchAndRetry() {
    setError("");
    setLoading("switching");
    try {
      await switchToSepolia();
      const wallet = await connectWallet();
      onConnect(wallet);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(null);
    }
  }

  if (continuingRun) {
    const scenarioMeta = SCENARIOS.find((s) => s.id === continuingRun.continuation.scenarioId);
    if (!scenarioMeta) {
      // Only possible if a scenario id gets renamed/removed after a
      // continuation was saved for it — fail visibly rather than crash.
      return (
        <div className="step-panel center-panel">
          <div className="connect-card">
            <div className="error-box">
              Can't continue this run: scenario "{continuingRun.continuation.scenarioId}" isn't
              recognized anymore.
            </div>
            <button className="btn-secondary" style={{ marginTop: "0.75rem", fontSize: 12 }} onClick={() => setContinuingRun(null)}>
              ← Back
            </button>
          </div>
        </div>
      );
    }
    // "My Runs" only ever saved ids/names (see saveRun in
    // LiveDemoPanel.jsx), not the full proposals — recovered here from
    // the scenario's own current proposal list so the banner can show
    // descriptions too, same as a fresh deploy does. `startingConditionIds`
    // is the current (array, possibly several combined) field; a run
    // saved before that shipped only has the older singular
    // startingConditionId/startingConditionName, handled as a one-element
    // fallback rather than showing nothing for those older runs.
    const run = continuingRun.run;
    const savedIds = run.startingConditionIds
      ?? (run.startingConditionId && run.startingConditionId !== "as_researched" ? [run.startingConditionId] : []);
    const startingConditions = savedIds.length > 0
      ? savedIds.map((id, i) =>
          scenarioMeta.data.startingConditionProposals?.find((p) => p.id === id)
          || { name: (run.startingConditionNames || [run.startingConditionName])[i] || id }
        )
      : [];
    return (
      <div className="step-panel center-panel">
        <LiveRunPanel
          scenario={scenarioMeta.data}
          scenarioId={continuingRun.continuation.scenarioId}
          registryAddress={continuingRun.run.registryAddress}
          initialCheckpoint={continuingRun.continuation}
          startingConditions={startingConditions}
          onExit={() => { setMyRuns(listRuns()); setContinuingRun(null); setShowMyRuns(true); }}
        />
      </div>
    );
  }

  return (
    <div className="step-panel center-panel">
      <div className="hero-section">
        <div className="hero-icon">⬡</div>
        <h1>Governance Playground</h1>
        <p className="hero-tagline">
          A transparent, tamper-proof political science lab.<br />
          Nation agents read real, live news — this isn't fiction playing out on a script.<br />
          Run controlled experiments on real-world governance scenarios.<br />
          Every finding recorded on-chain — citable, reproducible, immutable.
        </p>
      </div>

      {!showLiveDemo && !showMyRuns && (
        <div className="connect-card">
          <h2>Connect</h2>
          <p className="muted" style={{ fontSize: 12 }}>
            No wallet? Try the live demo below — a real Sepolia deployment with zero
            setup. Dev Mode needs <code style={{ fontFamily: "monospace", color: "#818cf8" }}>npx hardhat node</code> running
            locally. MetaMask works with either your local Hardhat node or the public Sepolia testnet.
          </p>

          <div className="connect-options">
            <button
              className="connect-option primary"
              onClick={() => setShowLiveDemo(true)}
              disabled={!!loading}
            >
              <span className="connect-option-icon">🌐</span>
              <div className="connect-option-text">
                <strong>Live Demo (no wallet needed)</strong>
                <span>Real Sepolia deployment, server-signed — see it work in under a minute of setup</span>
              </div>
            </button>

            <button
              className="connect-option secondary"
              onClick={() => handle("direct")}
              disabled={!!loading}
            >
              <span className="connect-option-icon">⚡</span>
              <div className="connect-option-text">
                <strong>{loading === "direct" ? "Connecting…" : "Dev Mode (local dev)"}</strong>
                <span>Direct RPC to local Hardhat — no confirmation prompts</span>
              </div>
            </button>

            <button
              className="connect-option secondary"
              onClick={() => handle("metamask")}
              disabled={!!loading}
            >
              <span className="connect-option-icon">🦊</span>
              <div className="connect-option-text">
                <strong>{loading === "metamask" ? "Connecting…" : "MetaMask"}</strong>
                <span>Local Hardhat or Sepolia — requires approval for each transaction, fully interactive</span>
              </div>
            </button>
          </div>

          {error && (
            <div className="error-box">
              {error.message}
              {error.unsupportedNetwork && (
                <div style={{ marginTop: "0.6rem" }}>
                  <button
                    className="btn-secondary"
                    onClick={handleSwitchAndRetry}
                    disabled={!!loading}
                    style={{ fontSize: 12, padding: "0.4rem 0.75rem" }}
                  >
                    {loading === "switching" ? "Switching…" : "Switch MetaMask to Sepolia →"}
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            className="btn-secondary"
            style={{ marginTop: "0.75rem", fontSize: 12 }}
            onClick={() => { setMyRuns(listRuns()); setShowMyRuns(true); }}
          >
            📁 My Runs {myRuns.length > 0 ? `(${myRuns.length})` : ""}
          </button>
        </div>
      )}

      {showLiveDemo && (
        <LiveDemoPanel
          onBack={() => setShowLiveDemo(false)}
          onWantWallet={() => setShowLiveDemo(false)}
          // Distinct from onBack: this one lands directly on "My Runs",
          // not just the plain home screen — same one-click destination
          // the resume path's own onExit already gives (see this file's
          // <LiveRunPanel onExit=...> above). Used only after a deploy or
          // a finished run, where "go find this on My Runs" is exactly
          // what the visitor is trying to do next, not "start over."
          onBackToMyRuns={() => { setMyRuns(listRuns()); setShowLiveDemo(false); setShowMyRuns(true); }}
        />
      )}

      {showMyRuns && (
        <div className="connect-card">
          <h2>My Runs</h2>
          <p className="muted" style={{ fontSize: 12 }}>
            Deploys you've made from this browser, on the no-wallet demo path — remembered locally,
            not tied to an account. Each link reads that run's real, current state straight from
            Sepolia, so it works for anyone you share it with too. A run that hasn't reached its
            full cycle count yet can be continued right here, on this browser — it picks up the
            exact quantum/market state where it left off, not a fresh restart.
          </p>

          {myRuns.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No runs saved on this browser yet.</p>}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
            {myRuns.map((run) => {
              const continuation = getContinuation(run.registryAddress);
              return (
              <div
                key={run.registryAddress}
                className="muted"
                style={{ fontSize: 12, border: "1px solid currentColor", borderRadius: 4, padding: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}
              >
                <div>
                  <strong>{run.scenarioName}</strong> — {(run.startingConditionNames || [run.startingConditionName]).join(" + ")}
                  <div style={{ fontFamily: "monospace", fontSize: 11 }}>
                    {run.registryAddress.slice(0, 10)}… · {new Date(run.savedAt).toLocaleString()}
                  </div>
                  {continuation && (
                    <div style={{ fontSize: 11, marginTop: "0.2rem" }}>
                      At cycle {continuation.cycleIndex} — agent cycles can still run on this
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                  {continuation && (
                    <button
                      className="btn-primary"
                      style={{ fontSize: 11, padding: "0.3rem 0.6rem" }}
                      onClick={() => setContinuingRun({ run, continuation })}
                    >
                      ▶ Continue
                    </button>
                  )}
                  <a
                    className="btn-secondary"
                    style={{ fontSize: 11, padding: "0.3rem 0.6rem" }}
                    href={`${window.location.pathname}${viewUrlFor(run)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View →
                  </a>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 11, padding: "0.3rem 0.6rem" }}
                    onClick={() => { removeRun(run.registryAddress); setMyRuns(listRuns()); }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              );
            })}
          </div>

          <button className="btn-secondary" style={{ marginTop: "0.75rem", fontSize: 12 }} onClick={() => setShowMyRuns(false)}>
            ← Back
          </button>
        </div>
      )}

      <div className="feature-row">
        <div className="feature">
          <span className="feature-icon">📰</span>
          <strong>Real news, programmable</strong>
          <span>Live headlines feed every decision — a news outlet you can run experiments on</span>
        </div>
        <div className="feature">
          <span className="feature-icon">🔬</span>
          <strong>Controlled experiments</strong>
          <span>One variable changed at a time</span>
        </div>
        <div className="feature">
          <span className="feature-icon">⛓</span>
          <strong>On-chain record</strong>
          <span>Every cycle permanently recorded</span>
        </div>
        <div className="feature">
          <span className="feature-icon">📊</span>
          <strong>Citable findings</strong>
          <span>Results traceable to specific blocks</span>
        </div>
      </div>
    </div>
  );
}
