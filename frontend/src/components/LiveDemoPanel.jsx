import { useState, useRef } from "react";
import { LiveRunPanel } from "./LiveRunPanel";
import MIDDLE_EAST_2026 from "../scenarios/middle-east-2026.json";
import TAIWAN_STRAIT_2026 from "../scenarios/taiwan-strait-2026.json";

const SERVER_URL = "/api";

const SCENARIOS = [
  { id: "middle-east-2026", name: "Middle East 2026", blurb: "Israel, Iran, Saudi Arabia, United States", data: MIDDLE_EAST_2026 },
  { id: "taiwan-strait-2026", name: "Taiwan Strait", blurb: "China, Taiwan, Japan", data: TAIWAN_STRAIT_2026 },
];

/**
 * No-wallet path: deploys a real, isolated scenario instance on Sepolia
 * using a server-held demo key, so a visitor with no MetaMask and no
 * testnet ETH can still see a genuine on-chain deployment — and, once
 * deployed, can optionally watch it play out for real too (LiveRunPanel):
 * real Claude decisions, real quantum collapse, real Sepolia commits, no
 * wallet needed for any of it, no human review in between (that's the
 * one deliberate difference from the wallet-connected researcher tool —
 * see LiveRunPanel's own header comment).
 */
export function LiveDemoPanel({ onBack, onWantWallet }) {
  const [scenarioId, setScenarioId] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | deploying | done | running | error
  const [result, setResult] = useState(null);
  const [runSeed, setRunSeed] = useState(null); // { state, mac } — bridges deploy's last step into commit-cycle's first
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [progress, setProgress] = useState({ stepIndex: 0, totalSteps: null, label: "", txHashes: [] });

  // The last successfully-sealed checkpoint — a ref, not state, so a retry
  // reads the exact values a mid-loop failure left behind rather than a
  // stale closure over whatever `runDemo` captured at the start. A real
  // multi-minute run is ~21 sequential requests; a dropped WiFi connection
  // or a backgrounded tab getting its network suspended partway through
  // (both hit this in practice, not hypothetically — see the "Failed to
  // fetch" case this was built for) shouldn't cost everything already
  // confirmed on-chain.
  const checkpoint = useRef({ stepIndex: 0, state: {}, mac: undefined });

  /**
   * A full deploy is ~15-20 confirmed on-chain transactions over several
   * minutes — too long for one serverless request (that mismatch is what
   * used to break this originally: the platform killed the request and
   * returned a non-JSON timeout page, the "Unexpected token 'A'..." error).
   * So this drives it as a loop instead: one step per request, each one a
   * single transaction, with the server handing back sealed state to echo
   * into the next call. See server.js's /api/demo/deploy/step.
   *
   * A SECOND failure mode surfaces here too, distinct from that one:
   * `fetch()` itself can reject — no HTTP response at all — when the
   * connection drops mid-run (real Sepolia block times mean this loop can
   * run several real minutes; a laptop sleeping, a tab getting throttled
   * in the background, a WiFi hiccup, are all real events over that
   * window, confirmed live: a user hit exactly this). The browser's own
   * error for that is the bare, unhelpful "Failed to fetch" — caught below
   * and given a real explanation, plus resumed from the last confirmed
   * step instead of losing the run.
   */
  async function driveLoop(id) {
    try {
      while (true) {
        const { stepIndex, state, mac } = checkpoint.current;
        const res = await fetch(`${SERVER_URL}/demo/deploy/step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenarioId: id, stepIndex, state, mac }),
        });

        // A dead/misconfigured serverless function, a proxy error, or a
        // platform timeout page all come back as HTML or plain text, not
        // JSON — this is what actually threw before. Fail with a legible
        // message instead of handing a SyntaxError to the catch block.
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          const text = await res.text();
          throw new Error(`Server returned a non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Demo deploy step failed");

        setProgress((p) => ({
          stepIndex: data.stepIndex,
          totalSteps: data.totalSteps,
          label: data.label,
          txHashes: data.txHash ? [...p.txHashes, data.txHash] : p.txHashes,
        }));

        if (data.done) {
          setResult(data.result);
          setRunSeed({ state: data.runState, mac: data.runMac });
          setStatus("done");
          return;
        }

        // Only advance the checkpoint on a confirmed successful response —
        // this is what makes retry-from-here safe: whatever's in the ref
        // when a failure is caught is always the last step the server
        // actually completed, never a half-applied one.
        checkpoint.current = { stepIndex: data.stepIndex + 1, state: data.state, mac: data.mac };
      }
    } catch (e) {
      setError(e.message);
      // The server's own answer to "this state doesn't check out" is the
      // one failure retrying can't fix — anything else (a network drop, a
      // platform timeout page, a transient 5xx) is worth trying again from
      // the same checkpoint.
      setRetryable(!/Invalid or tampered/.test(e.message));
      setStatus("error");
    }
  }

  function runDemo(id) {
    setScenarioId(id);
    setStatus("deploying");
    setError("");
    setProgress({ stepIndex: 0, totalSteps: null, label: "Starting…", txHashes: [] });
    checkpoint.current = { stepIndex: 0, state: {}, mac: undefined };
    driveLoop(id);
  }

  function retryDemo() {
    setStatus("deploying");
    setError("");
    driveLoop(scenarioId);
  }

  if (status === "running" && result && runSeed) {
    return (
      <LiveRunPanel
        scenario={SCENARIOS.find((s) => s.id === scenarioId)?.data}
        scenarioId={scenarioId}
        registryAddress={result.registryAddress}
        sealedState={runSeed.state}
        sealedMac={runSeed.mac}
        onExit={() => setStatus("done")}
      />
    );
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
          <p style={{ fontSize: 13, fontWeight: 600 }}>{progress.label}</p>
          <p className="muted" style={{ fontSize: 12 }}>
            {progress.totalSteps ? `Step ${progress.stepIndex + 1} of ${progress.totalSteps}` : "Starting…"}
            {" — each step is a real, separately confirmed Sepolia transaction (~6 minutes"}
            {" end to end, on purpose: this isn't faking testnet block times)."}
          </p>
          {progress.txHashes.length > 0 && (
            <div
              className="muted"
              style={{
                fontSize: 11, fontFamily: "monospace", textAlign: "left", maxHeight: 120,
                overflowY: "auto", marginTop: "0.75rem", padding: "0.5rem", border: "1px solid currentColor",
                borderRadius: 4, opacity: 0.8,
              }}
            >
              {progress.txHashes.map((hash) => (
                <div key={hash}>
                  <a href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noopener noreferrer">
                    {hash}
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {status === "error" && (
        <div className="error-box">
          {error}
          {retryable && (
            <p className="muted" style={{ fontSize: 12, marginTop: "0.4rem" }}>
              Whatever confirmed on-chain so far ({progress.txHashes.length} transaction
              {progress.txHashes.length === 1 ? "" : "s"}) isn't lost — retrying picks up
              from step {progress.stepIndex + 1} of {progress.totalSteps}, not the start.
            </p>
          )}
          <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {retryable && (
              <button className="btn-primary" onClick={retryDemo} style={{ fontSize: 12 }}>
                ↻ Retry from here
              </button>
            )}
            <button className="btn-secondary" onClick={() => setStatus("idle")} style={{ fontSize: 12 }}>
              ← Start a new deploy
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
            That's real — check any of those addresses on Etherscan yourself. From here you
            can watch it run right now with no wallet at all, or connect your own wallet next
            to drive it yourself (with the human review this autonomous run skips) — either
            way the result is just as real and citable.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={() => setStatus("running")}>
              ▶ Watch it play out (no wallet)
            </button>
            <button className="btn-secondary" onClick={onWantWallet}>
              Connect a wallet to play →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
