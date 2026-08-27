import { useState, useRef, useEffect } from "react";
import {
  runAutonomousCycle, buildNationMeta, CYCLE_COUNT_OPTIONS, initSimState,
  buildDecisionRecords, summarizeQuantum, summarizeMarket,
} from "../lib/cycleRunner";
import { initQuantumBeliefs, initMarketBeliefs } from "../lib/agents";
import { stabilityLabel, stabilityColor } from "../lib/simulation";
import { estimateRemainingMs, formatDuration } from "../lib/eta";
import { saveContinuation, clearContinuation } from "../lib/runHistory";
import { ExperimentBanner } from "./ExperimentBanner";

const SERVER_URL = "/api";

function actionLabel(id) {
  if (!id) return "—";
  return id.replace(/_/g, " ");
}

/**
 * The no-wallet counterpart to AICycleStep.jsx: watch a scenario play out
 * autonomously — real Claude decisions, real quantum collapse, real
 * Sepolia commits — with no human review or edit in between. That's a
 * deliberate difference from the wallet-connected researcher tool, not a
 * missing feature: a passive visitor isn't playing researcher, so showing
 * the AI's unedited conclusion is the more honest demo, not a lesser one.
 *
 * Everything that decides what gets written (agent decisions, quantum
 * collapse, market resolution) runs right here in the browser — the same
 * lib/cycleRunner.js pipeline the wallet flow's commit button uses — with
 * no wallet involved at all. The ONLY server round trip that needs the
 * demo signer is the final commitCycle() write itself, one per cycle, via
 * /api/demo/commit-cycle. See that route's and commitDemoCycle's own
 * comments for why the in-flight state is HMAC-sealed rather than trusted
 * outright.
 *
 * Reachable two ways: fresh, right after a deploy (LiveDemoPanel.jsx
 * passes `sealedState`/`sealedMac` from cycle 0), or resuming a saved run
 * from "My Runs" (ConnectStep.jsx passes `initialCheckpoint`, the state
 * this component itself persisted — via runHistory.js's
 * saveContinuation — the last time cycles ran on this registry, possibly
 * in an earlier session). Either way the actual cycle loop below is
 * identical; only where checkpoint.current starts from differs.
 */
export function LiveRunPanel({ scenario, scenarioId, registryAddress, sealedState, sealedMac, initialCheckpoint, startingConditions, onExit, onBackToHome }) {
  const nationMeta = buildNationMeta(scenario);
  const nationIds = scenario.nations.map((n) => n.id);
  const resuming = !!initialCheckpoint && initialCheckpoint.cycleIndex > 0;
  // Both derived from props, not from checkpoint.current — React
  // disallows reading a ref's value during render (checkpoint is a ref
  // specifically so driveLoop/runAll can read and mutate it synchronously
  // without forcing a re-render on every intermediate step; the render
  // body needs its own, React-visible source for the same numbers).
  // startCycleIndex is stable for the whole session; reachedCycleIndex
  // (below, computed where it's used) tracks it forward as `history`
  // grows — one state update per real committed cycle, so it's always in
  // sync with what's actually rendered, unlike a stale ref read would be.
  const startCycleIndex = initialCheckpoint?.cycleIndex ?? 0;
  // Stability at the moment THIS session started — the resumed
  // checkpoint's value when continuing a saved run, the scenario's true
  // starting value otherwise. Deliberately not read from the `simState`
  // state variable: that gets overwritten as cycles commit, so by the
  // time the "finished" screen renders it no longer reflects where this
  // session began.
  const sessionStartStability = (initialCheckpoint?.simState ?? initSimState(scenario)).stability;
  // The contract's own real cap (set once at deploy — see
  // scenario.simulation.defaultCycles), not this session's chosen count —
  // bounds how many MORE cycles are actually possible. Picking past it
  // would just get rejected once the contract's own _advanceCycle()
  // refuses ("simulation complete"), so it's filtered out of the
  // "picking" screen's options below instead of offered as a dead end.
  const maxAdditionalCycles = scenario.simulation.defaultCycles - startCycleIndex;
  const cycleOptions = CYCLE_COUNT_OPTIONS.filter((n) => n <= maxAdditionalCycles);

  const [phase, setPhase] = useState("picking"); // picking | thinking | committing | finished | error
  const [totalCycles, setTotalCycles] = useState(3);
  const [cycleIndex, setCycleIndex] = useState(initialCheckpoint?.cycleIndex ?? 0);
  const [simState, setSimState] = useState(() => initialCheckpoint?.simState ?? initSimState(scenario));
  const [agentMemory, setAgentMemory] = useState(() => initialCheckpoint?.agentMemory ?? ({
    quantum: initQuantumBeliefs(scenario),
    markets: initMarketBeliefs(scenario),
  }));
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);

  // The last successfully-committed checkpoint — a ref, not state, so a
  // retry reads exactly what the last confirmed commit-cycle response left
  // behind, not a stale closure. Only ever advanced after a real 200 from
  // /api/demo/commit-cycle (see below), so it's safe to resume from: never
  // half-applied. A full run is several real minutes (Claude decisions +
  // a Sepolia confirmation, per cycle) — long enough for the same "Failed
  // to fetch" mid-run network drop the deploy loop was hardened against
  // (LiveDemoPanel.jsx) to hit here too. Starts from `initialCheckpoint`
  // when resuming a saved run, from cycle 0's freshly-sealed state
  // otherwise — see this component's own header comment.
  const checkpoint = useRef(
    initialCheckpoint || { cycleIndex: 0, state: sealedState, mac: sealedMac, simState, agentMemory }
  );

  // Same live elapsed/ETA pattern as LiveDemoPanel.jsx's deploy phase —
  // see estimateRemainingMs's own header comment for why this is a real,
  // data-driven estimate (built from this run's own pace) rather than a
  // fixed guess. `elapsedMs` is state, not a ref read during render:
  // Date.now() and the ref itself are only ever touched inside the
  // interval callback below, an effect, never in the render body itself.
  const runStartRef = useRef(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (phase !== "thinking" && phase !== "committing") return;
    const id = setInterval(() => {
      if (runStartRef.current) setElapsedMs(Date.now() - runStartRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  async function driveLoop(count) {
    // Captured once, before the loop can advance checkpoint.current — the
    // server's rate limiter (demoRunLimiter) needs to know which request
    // is "the start of a run action" a visitor actually clicked, distinct
    // from every later cycle in the same drive-loop invocation. Cycle 0
    // isn't a reliable signal for that once resuming exists (a resumed
    // run's first request is never cycle 0) — see server.js's own comment
    // on why `runStart` replaced that check.
    const loopStartIndex = checkpoint.current.cycleIndex;
    try {
      for (let i = loopStartIndex; i < count; i++) {
        setCycleIndex(i);
        setPhase("thinking");

        const cycleNumber = i + 1; // buildWorldState/applyDecisions use 1-based cycle numbers, matching AICycleStep
        const { decisions, committed, quantum, market, newAgentMemory } = await runAutonomousCycle(
          scenario, checkpoint.current.simState, cycleNumber, checkpoint.current.agentMemory
        );

        setPhase("committing");
        const res = await fetch(`${SERVER_URL}/demo/commit-cycle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenarioId,
            cycleIndex: i,
            totalCycles: count,
            runStart: i === loopStartIndex,
            state: checkpoint.current.state,
            mac: checkpoint.current.mac,
            metrics: {
              stability: committed.stability,
              conflicts: committed.conflicts,
              trade: committed.trade,
              proxy: committed.proxy,
              dealIntegrity: committed.dealIntegrity,
            },
            // The actual reasoning behind those metrics — written on-chain
            // as event logs (DecisionRecorded/CycleNarrativeRecorded), not
            // contract storage, specifically so a run is replayable later
            // (see ViewRunPage.jsx), not just its final numbers.
            decisions: buildDecisionRecords(decisions),
            quantumSummary: summarizeQuantum(scenario, quantum),
            marketSummary: summarizeMarket(market),
          }),
        });

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          const text = await res.text();
          throw new Error(`Server returned a non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Cycle commit failed");

        checkpoint.current = {
          cycleIndex: i + 1, state: data.state, mac: data.mac, simState: committed, agentMemory: newAgentMemory,
        };

        // Persisted after every real commit, not just at the end — so
        // "Continue this run" from My Runs can pick up from the exact
        // cycle just committed even if the tab closes right here. Cleared
        // once the contract itself reports the simulation over
        // (out.simulationActive: false, from commitDemoCycle reading the
        // real on-chain state): _advanceCycle() then refuses any further
        // cycle for this registry, so there is nothing left to resume.
        if (data.simulationActive) {
          saveContinuation(registryAddress, {
            scenarioId, cycleIndex: checkpoint.current.cycleIndex, state: data.state, mac: data.mac,
            simState: committed, agentMemory: newAgentMemory, simulationActive: true,
          });
        } else {
          clearContinuation(registryAddress);
        }

        const snapshot = { cycle: cycleNumber, committed, decisions, quantum, market, txHash: data.txHash };
        setHistory((h) => [...h, snapshot]);
        setSimState(committed);
        setAgentMemory(newAgentMemory);
      }
      setPhase("finished");
    } catch (e) {
      setError(e.message);
      setRetryable(!/Invalid or tampered/.test(e.message));
      setPhase("error");
    }
  }

  // `additionalCount` is what the picker actually offers ("3 more
  // cycles"), not an absolute target — fresh runs start from cycle 0
  // (checkpoint.current already is {cycleIndex: 0, ...} from the useRef
  // initializer above) so the two are the same number there, but resuming
  // a saved run needs the real absolute target: cycle 3 + "5 more" = 8,
  // not 5. checkpoint.current is deliberately left alone here — it
  // already holds the right starting point for either case.
  function runAll(additionalCount) {
    // startCycleIndex, not checkpoint.current.cycleIndex: runAll only
    // ever runs from the "picking" screen, before any cycle in this
    // session has committed, so the two are always equal here — using
    // the prop-derived value instead of the ref keeps this function (and
    // everything that references it, including the JSX below) free of
    // ref reads, which React's render rules disallow.
    const target = startCycleIndex + additionalCount;
    setTotalCycles(target);
    setError("");
    // Only ever runs from this onClick-triggered function, never during
    // render; see the identical case in LiveDemoPanel.jsx's startDeploy.
    // eslint-disable-next-line react-hooks/purity
    runStartRef.current = Date.now();
    setElapsedMs(0);
    driveLoop(target);
  }

  function retryRun() {
    setError("");
    driveLoop(totalCycles);
  }

  const latest = history[history.length - 1];

  return (
    <div className="connect-card" style={{ marginTop: "1.25rem" }}>
      <h2>Watching It Play Out</h2>
      <ExperimentBanner scenarioName={scenario.meta.name} startingConditions={startingConditions} scenarioData={scenario} />

      {phase === "picking" && (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            {resuming
              ? `Continuing from cycle ${startCycleIndex} — the exact quantum/market state this run had, picked up right where it left off, on this browser. Real Claude Opus 5 decisions, real quantum collapse, real commits, same as before.`
              : "Runs the scenario autonomously — real Claude Opus 5 decisions for every nation, real quantum collapse, real commits to the deployment you just watched go live. No pausing for review or edits; this is the AI's reasoning unedited, which is why it's read-only."}
            {" "}Each cycle is several real API calls plus a real Sepolia confirmation — expect
            roughly a minute per cycle.
          </p>
          {maxAdditionalCycles <= 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              This scenario's on-chain simulation has already reached its full
              {" "}{scenario.simulation.defaultCycles}-cycle run — there's nothing left to advance.
            </p>
          ) : (
            <div className="connect-options">
              {cycleOptions.map((n) => (
                <button key={n} className="connect-option secondary" onClick={() => runAll(n)}>
                  <span className="connect-option-icon">▶</span>
                  <div className="connect-option-text">
                    <strong>{n} {resuming ? "more " : ""}cycle{n === 1 ? "" : "s"}</strong>
                    <span>~{n} minute{n === 1 ? "" : "s"}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          <button className="btn-secondary" style={{ marginTop: "0.75rem", fontSize: 12 }} onClick={onExit}>
            ← Back
          </button>
        </>
      )}

      {(phase === "thinking" || phase === "committing") && (
        <div>
          <p style={{ fontSize: 13, fontWeight: 600 }}>
            Cycle {cycleIndex + 1} of {totalCycles}
            {phase === "thinking" ? " — nations are reasoning…" : " — committing to Sepolia…"}
          </p>
          {(() => {
            const etaMs = estimateRemainingMs(history.length, totalCycles, elapsedMs);
            const etaText = formatDuration(etaMs);
            return (
              <p className="muted" style={{ fontSize: 11 }}>
                Elapsed: {formatDuration(elapsedMs) || "0s"}
                {etaText ? ` — about ${etaText} remaining, based on this run's own pace so far` : ""}
              </p>
            );
          })()}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0.5rem 0" }}>
            {nationIds.map((id) => (
              <span
                key={id}
                className="muted"
                style={{
                  fontSize: 12, padding: "0.2rem 0.5rem", borderRadius: 4,
                  border: `1px solid ${nationMeta[id]?.color || "currentColor"}`,
                }}
              >
                {nationMeta[id]?.flag} {nationMeta[id]?.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (phase === "thinking" || phase === "committing" || phase === "finished") && (
        <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {history.map((h) => (
            <div key={h.cycle} className="muted" style={{ fontSize: 12, borderTop: "1px solid currentColor", paddingTop: "0.5rem", opacity: 0.9 }}>
              <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Cycle {h.cycle}</div>
              {Object.entries(h.decisions).map(([id, r]) => (
                <div key={id} style={{ marginBottom: "0.15rem" }}>
                  <strong>{nationMeta[id]?.flag} {nationMeta[id]?.label}:</strong>{" "}
                  {r.error ? `(error: ${r.error})` : actionLabel(r.decision?.primaryAction)}
                  {r.decision?.reasoning && !r.error && (
                    <span> — {r.decision.reasoning}</span>
                  )}
                </div>
              ))}
              {h.quantum?.entangledEffect?.label && (
                <div style={{ marginTop: "0.25rem" }}>
                  ⚛ Quantum collapse: <strong>{h.quantum.entangledEffect.label}</strong>
                </div>
              )}
              <div style={{ marginTop: "0.25rem" }}>
                Stability now <strong style={{ color: stabilityColor(h.committed.stability) }}>
                  {h.committed.stability} ({stabilityLabel(h.committed.stability)})
                </strong>
                {" — "}
                <a href={`https://sepolia.etherscan.io/tx/${h.txHash}`} target="_blank" rel="noopener noreferrer">
                  {h.txHash.slice(0, 14)}…
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {phase === "error" && (
        <div className="error-box" style={{ marginTop: "1rem" }}>
          {error}
          {retryable && history.length > 0 && (
            <p className="muted" style={{ fontSize: 12, marginTop: "0.4rem" }}>
              Cycle{history.length === 1 ? "" : "s"} 1–{history.length} already committed for real above
              — retrying picks up at cycle {history.length + 1}, not the start.
            </p>
          )}
          <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {retryable && (
              <button className="btn-primary" onClick={retryRun} style={{ fontSize: 12 }}>
                ↻ Retry from here
              </button>
            )}
            <button className="btn-secondary" onClick={onExit} style={{ fontSize: 12 }}>
              ← Back
            </button>
          </div>
        </div>
      )}

      {phase === "finished" && (() => {
        // Derived from `history` (state) rather than checkpoint.current
        // (a ref) — see startCycleIndex's own comment above for why:
        // this stays correct across re-renders instead of risking a
        // stale read.
        const reachedCycleIndex = startCycleIndex + history.length;
        const remaining = scenario.simulation.defaultCycles - reachedCycleIndex;
        return (
          <div style={{ marginTop: "1rem" }}>
            <p style={{ color: "#4ade80", fontWeight: 600 }}>
              ✓ {history.length} cycle{history.length === 1 ? "" : "s"} committed for real, on Sepolia
              {resuming ? ` — this registry is now at cycle ${reachedCycleIndex} overall` : ""}.
            </p>
            <p className="muted" style={{ fontSize: 12 }}>
              Stability moved from {sessionStartStability} to {latest?.committed.stability} over
              {" "}{history.length} cycle{history.length === 1 ? "" : "s"}{resuming ? " this session" : ""}, unedited
              AI reasoning throughout. Every transaction above is independently checkable on Etherscan — this
              wasn't curated for the demo.
            </p>
            {remaining > 0 && (
              <p className="muted" style={{ fontSize: 12, marginTop: "0.5rem" }}>
                This run isn't finished — {remaining} more cycle{remaining === 1 ? "" : "s"} are still possible.
                Come back to "My Runs" any time on this browser to continue it.
              </p>
            )}
            <p className="muted" style={{ fontSize: 12, marginTop: "0.5rem" }}>
              Registry: <a href={`https://sepolia.etherscan.io/address/${registryAddress}`} target="_blank" rel="noopener noreferrer">{registryAddress}</a>
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
              <button className="btn-secondary" style={{ fontSize: 12 }} onClick={onExit}>
                ← Back
              </button>
              {/* Fresh-deploy path only (LiveDemoPanel.jsx): its own onExit
                  only pops back to the deploy-summary screen, not out to
                  the scenario picker/"My Runs" list — this is the one-click
                  way there. The resume path (ConnectStep.jsx) doesn't pass
                  this because its own onExit already goes straight home. */}
              {onBackToHome && (
                <button className="btn-primary" style={{ fontSize: 12 }} onClick={onBackToHome}>
                  🏠 Back to My Runs
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
