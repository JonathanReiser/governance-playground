import { useState, useRef } from "react";
import {
  runAutonomousCycle, buildNationMeta, CYCLE_COUNT_OPTIONS, initSimState,
  buildDecisionRecords, summarizeQuantum, summarizeMarket,
} from "../lib/cycleRunner";
import { initQuantumBeliefs, initMarketBeliefs } from "../lib/agents";
import { stabilityLabel, stabilityColor } from "../lib/simulation";

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
 */
export function LiveRunPanel({ scenario, scenarioId, registryAddress, sealedState, sealedMac, onExit }) {
  const nationMeta = buildNationMeta(scenario);
  const nationIds = scenario.nations.map((n) => n.id);

  const [phase, setPhase] = useState("picking"); // picking | thinking | committing | finished | error
  const [totalCycles, setTotalCycles] = useState(3);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [simState, setSimState] = useState(() => initSimState(scenario));
  const [agentMemory, setAgentMemory] = useState(() => ({
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
  // (LiveDemoPanel.jsx) to hit here too.
  const checkpoint = useRef({ cycleIndex: 0, state: sealedState, mac: sealedMac, simState, agentMemory });

  async function driveLoop(count) {
    try {
      for (let i = checkpoint.current.cycleIndex; i < count; i++) {
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

  function runAll(count) {
    setTotalCycles(count);
    setError("");
    checkpoint.current = { cycleIndex: 0, state: sealedState, mac: sealedMac, simState, agentMemory };
    driveLoop(count);
  }

  function retryRun() {
    setError("");
    driveLoop(totalCycles);
  }

  const latest = history[history.length - 1];

  return (
    <div className="connect-card" style={{ marginTop: "1.25rem" }}>
      <h2>Watching It Play Out</h2>

      {phase === "picking" && (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            Runs the scenario autonomously — real Claude Opus 5 decisions for every nation, real
            quantum collapse, real commits to the deployment you just watched go live. No pausing
            for review or edits; this is the AI's reasoning unedited, which is why it's read-only.
            Each cycle is several real API calls plus a real Sepolia confirmation — expect roughly
            a minute per cycle.
          </p>
          <div className="connect-options">
            {CYCLE_COUNT_OPTIONS.map((n) => (
              <button key={n} className="connect-option secondary" onClick={() => runAll(n)}>
                <span className="connect-option-icon">▶</span>
                <div className="connect-option-text">
                  <strong>{n} cycles</strong>
                  <span>~{n} minute{n === 1 ? "" : "s"}</span>
                </div>
              </button>
            ))}
          </div>
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

      {phase === "finished" && (
        <div style={{ marginTop: "1rem" }}>
          <p style={{ color: "#4ade80", fontWeight: 600 }}>
            ✓ {totalCycles} cycle{totalCycles === 1 ? "" : "s"} committed for real, on Sepolia.
          </p>
          <p className="muted" style={{ fontSize: 12 }}>
            Stability moved from {initSimState(scenario).stability} to {latest?.committed.stability} over
            {" "}{totalCycles} cycle{totalCycles === 1 ? "" : "s"}, unedited AI reasoning throughout. Every
            transaction above is independently checkable on Etherscan — this wasn't curated for the demo.
          </p>
          <p className="muted" style={{ fontSize: 12, marginTop: "0.5rem" }}>
            Registry: <a href={`https://sepolia.etherscan.io/address/${registryAddress}`} target="_blank" rel="noopener noreferrer">{registryAddress}</a>
          </p>
          <button className="btn-secondary" style={{ marginTop: "0.75rem", fontSize: 12 }} onClick={onExit}>
            ← Back
          </button>
        </div>
      )}
    </div>
  );
}
