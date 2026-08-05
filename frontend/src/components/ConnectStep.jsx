import { useState } from "react";
import { connectWallet, connectDirect } from "../lib/contracts";

export function ConnectStep({ onConnect }) {
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(null); // "direct" | "metamask" | null

  async function handle(mode) {
    setError("");
    setLoading(mode);
    try {
      const wallet = mode === "direct" ? await connectDirect() : await connectWallet();
      onConnect(wallet);
    } catch (e) {
      setError(e.message);
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

      <div className="connect-card">
        <h2>Connect to Hardhat</h2>
        <p className="muted" style={{ fontSize: 12 }}>
          Make sure <code style={{ fontFamily: "monospace", color: "#818cf8" }}>npx hardhat node</code> is running first.
        </p>

        <div className="connect-options">
          <button
            className="connect-option primary"
            onClick={() => handle("direct")}
            disabled={!!loading}
          >
            <span className="connect-option-icon">⚡</span>
            <div className="connect-option-text">
              <strong>{loading === "direct" ? "Connecting…" : "Dev Mode (Recommended)"}</strong>
              <span>Direct RPC — no confirmation prompts</span>
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
              <span>Requires approval for each transaction</span>
            </div>
          </button>
        </div>

        {error && <div className="error-box">{error}</div>}
      </div>

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
