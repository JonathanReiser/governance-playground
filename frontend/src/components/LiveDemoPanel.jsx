import { useState } from "react";

const SERVER_URL = "/api";

const SCENARIOS = [
  { id: "middle-east-2026", name: "Middle East 2026", blurb: "Israel, Iran, Saudi Arabia, United States" },
  { id: "taiwan-strait-2026", name: "Taiwan Strait", blurb: "China, Taiwan, Japan" },
];

/**
 * No-wallet path: deploys a real, isolated scenario instance on Sepolia
 * using a server-held demo key, so a visitor with no MetaMask and no
 * testnet ETH can still see a genuine on-chain deployment.
 *
 * Deliberately scoped to deploy-only for now, not the full Run/Results
 * flow — running AI cycles writes further transactions, and letting a
 * stranger's browser drive a signer it doesn't hold isn't attempted here
 * (see server/demoDeploy.js's header comment). A visitor who wants to
 * actually run cycles is pointed at connecting their own wallet next,
 * which is an honest, not a dead-end, next step — their own deploy is
 * just as real and citable as this one.
 */
export function LiveDemoPanel({ onBack, onWantWallet }) {
  const [scenarioId, setScenarioId] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | deploying | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function runDemo(id) {
    setScenarioId(id);
    setStatus("deploying");
    setError("");
    try {
      const res = await fetch(`${SERVER_URL}/demo/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Demo deploy failed");
      setResult(data);
      setStatus("done");
    } catch (e) {
      setError(e.message);
      setStatus("error");
    }
  }

  return (
    <div className="connect-card" style={{ marginTop: "1.25rem" }}>
      <h2>Live Demo — No Wallet Needed</h2>

      {status === "idle" && (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            Pick a scenario. This deploys a real, fresh instance on Sepolia — genuine
            transactions, genuine contract addresses, verifiable on Etherscan — using
            a server-held demo key instead of your own wallet.
          </p>
          <div className="connect-options">
            {SCENARIOS.map((s) => (
              <button key={s.id} className="connect-option secondary" onClick={() => runDemo(s.id)}>
                <span className="connect-option-icon">🌐</span>
                <div className="connect-option-text">
                  <strong>{s.name}</strong>
                  <span>{s.blurb}</span>
                </div>
              </button>
            ))}
          </div>
          <button className="btn-secondary" style={{ marginTop: "0.75rem", fontSize: 12 }} onClick={onBack}>
            ← Back
          </button>
        </>
      )}

      {status === "deploying" && (
        <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
          <p>Deploying {SCENARIOS.find((s) => s.id === scenarioId)?.name} to Sepolia…</p>
          <p className="muted" style={{ fontSize: 12 }}>
            This is ~15-20 real on-chain transactions, each waiting for a real Sepolia
            block — measured at ~6 minutes end to end. Not stuck, just honest about
            testnet block times: this is slower than most demos, on purpose, because
            it's not faking anything.
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="error-box">
          {error}
          <div style={{ marginTop: "0.6rem" }}>
            <button className="btn-secondary" onClick={() => setStatus("idle")} style={{ fontSize: 12 }}>
              ← Try again
            </button>
          </div>
        </div>
      )}

      {status === "done" && result && (
        <div>
          <p style={{ color: "#4ade80", fontWeight: 600 }}>✓ Deployed for real, on Sepolia.</p>
          <div className="muted" style={{ fontSize: 12, fontFamily: "monospace", lineHeight: 1.8 }}>
            <div>
              WorldRegistry:{" "}
              <a href={`https://sepolia.etherscan.io/address/${result.registryAddress}`} target="_blank" rel="noopener noreferrer">
                {result.registryAddress}
              </a>
            </div>
            <div>
              MetricsOracle:{" "}
              <a href={`https://sepolia.etherscan.io/address/${result.oracleAddress}`} target="_blank" rel="noopener noreferrer">
                {result.oracleAddress}
              </a>
            </div>
            {Object.values(result.nations).map((n) => (
              <div key={n.name}>
                {n.name} DAO:{" "}
                <a href={`https://sepolia.etherscan.io/address/${n.dao}`} target="_blank" rel="noopener noreferrer">
                  {n.dao}
                </a>
              </div>
            ))}
          </div>
          <p style={{ marginTop: "1rem", fontSize: 13 }}>
            That's real — check any of those addresses on Etherscan yourself. To run
            cycles and commit your own results on-chain, connect a wallet next; it's a
            few minutes of setup (MetaMask + free Sepolia testnet ETH), and your run is
            just as citable as this one.
          </p>
          <button className="btn-primary" style={{ marginTop: "0.5rem" }} onClick={onWantWallet}>
            Connect a wallet to play →
          </button>
        </div>
      )}
    </div>
  );
}
