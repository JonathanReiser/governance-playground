import { useState } from "react";
import { connectWallet, connectDirect, switchToSepolia } from "../lib/contracts";
import { LiveDemoPanel } from "./LiveDemoPanel";
import { listRuns, removeRun } from "../lib/runHistory";

export function ConnectStep({ onConnect }) {
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(null); // "direct" | "metamask" | "switching" | null
  const [showLiveDemo, setShowLiveDemo] = useState(false);
  const [showMyRuns, setShowMyRuns] = useState(false);
  const [myRuns, setMyRuns] = useState(() => listRuns());

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
        />
      )}

      {showMyRuns && (
        <div className="connect-card">
          <h2>My Runs</h2>
          <p className="muted" style={{ fontSize: 12 }}>
            Deploys you've made from this browser, on the no-wallet demo path — remembered locally,
            not tied to an account. Each link reads that run's real, current state straight from
            Sepolia, so it works for anyone you share it with too.
          </p>

          {myRuns.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No runs saved on this browser yet.</p>}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
            {myRuns.map((run) => (
              <div
                key={run.registryAddress}
                className="muted"
                style={{ fontSize: 12, border: "1px solid currentColor", borderRadius: 4, padding: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}
              >
                <div>
                  <strong>{run.scenarioName}</strong> — {run.startingConditionName}
                  <div style={{ fontFamily: "monospace", fontSize: 11 }}>
                    {run.registryAddress.slice(0, 10)}… · {new Date(run.savedAt).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                  <a
                    className="btn-secondary"
                    style={{ fontSize: 11, padding: "0.3rem 0.6rem" }}
                    href={`${window.location.pathname}?view=${run.registryAddress}`}
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
            ))}
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
