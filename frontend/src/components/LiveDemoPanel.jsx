import { useState, useRef, useEffect } from "react";
import { LiveRunPanel } from "./LiveRunPanel";
import { saveRun, saveContinuation, viewUrlFor } from "../lib/runHistory";
import { estimateRemainingMs, formatDuration } from "../lib/eta";
import { SCENARIOS } from "../lib/scenarios";
import { initSimState } from "../lib/cycleRunner";
import { initQuantumBeliefs, initMarketBeliefs } from "../lib/agents";

const SERVER_URL = "/api";

const FIELD_LABELS = {
  hardlinerPressure: "hardliner pressure", reformPressure: "reform pressure",
  diplomaticCapital: "diplomatic capital", sanctionsReliefPending: "sanctions relief pending",
  sanctioned: "sanctioned", treasury: "treasury",
};

/**
 * Turns a startingConditionProposal into a real, numeric "was X, becomes
 * Y" summary — the answer to "what actually is this baseline?" instead of
 * a name and a paragraph of prose. `as_researched` (no overrides) shows
 * the scenario's own current starting metrics directly; every other
 * proposal is diffed against those same numbers so the size of the
 * change is visible, not just its direction.
 */
function describeStartingCondition(scenarioData, proposal) {
  const metricName = (id) => scenarioData.simulation.metrics.find((m) => m.id === id)?.name || id;
  const metricValue = (id) => scenarioData.simulation.metrics.find((m) => m.id === id)?.startingValue;

  if (!proposal.overrides) {
    return scenarioData.simulation.metrics
      .map((m) => `${m.name}: ${m.startingValue}`)
      .join(" · ");
  }

  const parts = [];
  const { nations, metrics } = proposal.overrides;
  if (metrics) {
    for (const [id, value] of Object.entries(metrics)) {
      parts.push(`${metricName(id)}: ${metricValue(id)} → ${value}`);
    }
  }
  if (nations) {
    for (const [nationId, patch] of Object.entries(nations)) {
      const nation = scenarioData.nations.find((n) => n.id === nationId);
      for (const fields of Object.values(patch)) {
        for (const [field, value] of Object.entries(fields)) {
          const was = nation?.governance?.[field] ?? nation?.economy?.[field];
          const label = FIELD_LABELS[field] || field;
          parts.push(`${nation?.name || nationId} ${label}: ${String(was)} → ${String(value)}`);
        }
      }
    }
  }
  return parts.join(" · ");
}

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
  const [status, setStatus] = useState("idle"); // idle | background | picking-condition | deploying | done | running | error
  const [result, setResult] = useState(null);
  const [runSeed, setRunSeed] = useState(null); // { state, mac } — bridges deploy's last step into commit-cycle's first
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [progress, setProgress] = useState({ stepIndex: 0, totalSteps: null, label: "", txHashes: [] });

  // The last successfully-sealed checkpoint — a ref, not state, so a retry
  // reads the exact values a mid-loop failure left behind rather than a
  // stale closure over whatever `runDemo` captured at the start. A real
  // multi-minute run is ~10-12 sequential requests; a dropped WiFi connection
  // or a backgrounded tab getting its network suspended partway through
  // (both hit this in practice, not hypothetically — see the "Failed to
  // fetch" case this was built for) shouldn't cost everything already
  // confirmed on-chain. `overrideId` rides along too — set once when the
  // deploy starts, only actually read by the server on step 0 (see
  // server.js's /api/demo/deploy/step), but kept here so a retry of that
  // very first request still sends the same choice.
  const checkpoint = useRef({ stepIndex: 0, state: {}, mac: undefined, overrideId: undefined });

  // Wall-clock start of the current deploy attempt. `elapsedMs` is state,
  // not a ref read during render: Date.now() and the ref itself are only
  // ever touched inside the interval callback below, an effect, never in
  // the render body (React's purity rules disallow both there).
  const deployStartRef = useRef(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (status !== "deploying") return;
    const id = setInterval(() => {
      if (deployStartRef.current) setElapsedMs(Date.now() - deployStartRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  /**
   * A full deploy is ~10-12 confirmed on-chain transactions over a couple
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
        const { stepIndex, state, mac, overrideId } = checkpoint.current;
        const res = await fetch(`${SERVER_URL}/demo/deploy/step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenarioId: id, stepIndex, state, mac, overrideId }),
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

          const scenarioMeta = SCENARIOS.find((s) => s.id === id);
          const proposal = (scenarioMeta?.data.startingConditionProposals || [])
            .find((p) => p.id === data.state?.overrideId);
          saveRun({
            registryAddress: data.result.registryAddress,
            registryBlock: data.result.registryBlock,
            oracleAddress: data.result.oracleAddress,
            scenarioId: id,
            scenarioName: scenarioMeta?.name || id,
            startingConditionId: data.state?.overrideId || "as_researched",
            startingConditionName: proposal?.name || "Deploy as researched (default)",
          });
          // Seeds a resumable checkpoint at cycle 0 for every deployed run,
          // not just ones the visitor happens to click "Watch it play out"
          // on in this same session — so "My Runs" can offer a real
          // "Continue" button on ANY saved run later, from this browser,
          // even one nobody ran a single cycle on yet. LiveRunPanel.jsx
          // updates this same record after every cycle it actually commits.
          if (scenarioMeta) {
            saveContinuation(data.result.registryAddress, {
              scenarioId: id,
              cycleIndex: 0,
              state: data.runState,
              mac: data.runMac,
              simState: initSimState(scenarioMeta.data),
              agentMemory: {
                quantum: initQuantumBeliefs(scenarioMeta.data),
                markets: initMarketBeliefs(scenarioMeta.data),
              },
              simulationActive: true,
            });
          }
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

  function pickScenario(id) {
    setScenarioId(id);
    setStatus("background");
  }

  function startDeploy(overrideId) {
    setStatus("deploying");
    setError("");
    setProgress({ stepIndex: 0, totalSteps: null, label: "Starting…", txHashes: [] });
    checkpoint.current = { stepIndex: 0, state: {}, mac: undefined, overrideId };
    // Only ever runs from this onClick-triggered function, never during
    // render; the lint rule can't distinguish that statically for a
    // function this deep in the component body, but Date.now() here has
    // no render-timing risk.
    // eslint-disable-next-line react-hooks/purity
    deployStartRef.current = Date.now();
    setElapsedMs(0);
    driveLoop(scenarioId);
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
              <button key={s.id} className="connect-option secondary" onClick={() => pickScenario(s.id)}>
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

      {status === "background" && (() => {
        const scenarioData = SCENARIOS.find((s) => s.id === scenarioId)?.data;
        // The main real-world flashpoint each scenario is built around —
        // the peace deal / MOU / conflict-status event, not the secondary
        // resource-status one. Falls back to the first event if a
        // scenario's ordering ever changes, rather than showing nothing.
        const mainEvent =
          scenarioData.activeEvents.find((e) => e.type === "PEACE_DEAL") || scenarioData.activeEvents[0];
        return (
          <>
            <p className="muted" style={{ fontSize: 13 }}>{scenarioData.meta.description}</p>

            {mainEvent && (
              <div
                className="muted"
                style={{ fontSize: 12, margin: "0.75rem 0", padding: "0.6rem", border: "1px solid currentColor", borderRadius: 4 }}
              >
                <strong style={{ opacity: 0.95 }}>{mainEvent.name}</strong>
                <p style={{ margin: "0.35rem 0" }}>{mainEvent.description}</p>
                {mainEvent.source && <span style={{ fontStyle: "italic", opacity: 0.75 }}>Source: {mainEvent.source}</span>}
              </div>
            )}

            <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {scenarioData.nations.map((n) => (
                <div key={n.id} className="muted" style={{ fontSize: 12, borderTop: "1px solid currentColor", paddingTop: "0.5rem" }}>
                  <strong>{n.flag} {n.name}</strong>
                  <p style={{ margin: "0.25rem 0" }}>{n.governance.description}</p>
                  {n.governance.source && <span style={{ fontStyle: "italic", opacity: 0.7 }}>Source: {n.governance.source}</span>}
                </div>
              ))}
            </div>

            {scenarioData.meta.suggestedExperiments?.length > 0 && (
              <div style={{ marginTop: "0.75rem" }}>
                <p className="muted" style={{ fontSize: 12, fontWeight: 600, marginBottom: "0.3rem" }}>
                  What's actually contested right now:
                </p>
                <ul className="muted" style={{ fontSize: 12, margin: 0, paddingLeft: "1.2rem" }}>
                  {scenarioData.meta.suggestedExperiments.map((q) => <li key={q}>{q}</li>)}
                </ul>
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button className="btn-primary" style={{ fontSize: 13 }} onClick={() => setStatus("picking-condition")}>
                Continue →
              </button>
              <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setStatus("idle")}>
                ← Back
              </button>
            </div>
          </>
        );
      })()}

      {status === "picking-condition" && (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            Pick a starting condition. "Deploy as researched" uses this scenario's own cited
            baseline. Every other option is a real, currently-pending or currently-live policy
            proposal — picking one overrides only the specific numbers that proposal actually
            affects, real-world, nothing else.
          </p>
          <div className="connect-options">
            {(() => {
              const scenarioData = SCENARIOS.find((s) => s.id === scenarioId)?.data;
              return (scenarioData?.startingConditionProposals || []).map((p) => (
                <button key={p.id} className="connect-option secondary" onClick={() => startDeploy(p.id)}>
                  <span className="connect-option-icon">{p.id === "as_researched" ? "📌" : "📰"}</span>
                  <div className="connect-option-text">
                    <strong>{p.name}</strong>
                    <span>{p.description}</span>
                    <span style={{ fontFamily: "monospace", opacity: 0.9 }}>{describeStartingCondition(scenarioData, p)}</span>
                    {p.source && <span style={{ fontStyle: "italic", opacity: 0.75 }}>Source: {p.source}</span>}
                  </div>
                </button>
              ));
            })()}
          </div>
          <button className="btn-secondary" style={{ marginTop: "0.75rem", fontSize: 12 }} onClick={() => setStatus("background")}>
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
            {" — each step is a real, separately confirmed Sepolia transaction, on purpose:"}
            {" this isn't faking testnet block times."}
          </p>
          {(() => {
            const etaMs = estimateRemainingMs(progress.txHashes.length, progress.totalSteps, elapsedMs);
            const etaText = formatDuration(etaMs);
            return (
              <p className="muted" style={{ fontSize: 11 }}>
                Elapsed: {formatDuration(elapsedMs) || "0s"}
                {etaText ? ` — about ${etaText} remaining, based on this run's own pace so far` : ""}
              </p>
            );
          })()}
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
          <div className="muted" style={{ fontSize: 12, marginTop: "0.75rem", padding: "0.5rem", border: "1px solid currentColor", borderRadius: 4 }}>
            <strong>Bookmark or share this run:</strong>{" "}
            <a
              href={`${window.location.origin}${window.location.pathname}${viewUrlFor(result)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ wordBreak: "break-all" }}
            >
              {`${window.location.origin}${window.location.pathname}${viewUrlFor(result)}`}
            </a>
            <div style={{ marginTop: "0.25rem" }}>
              Anyone with this link can see this run's real, current on-chain state — no login, no
              wallet. It's also saved to "My Runs" on this browser, from the Connect screen.
            </div>
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
