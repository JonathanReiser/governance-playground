import { useState } from "react";
import { connectWallet, connectDirect, switchToSepolia } from "../lib/contracts";
import { LiveDemoPanel } from "./LiveDemoPanel";

export function ConnectStep({ onConnect }) {
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(null); // "direct" | "metamask" | "switching" | null
  const [showLiveDemo, setShowLiveDemo] = useState(false);

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
          Run controlled experiments on real-world governance scenarios.<br />
          Every finding recorded on-chain — citable, reproducible, immutable.
        </p>
      </div>

      {!showLiveDemo && (
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
        </div>
      )}

      {showLiveDemo && (
        <LiveDemoPanel
          onBack={() => setShowLiveDemo(false)}
          onWantWallet={() => setShowLiveDemo(false)}
        />
      )}

      <div className="feature-row">
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
