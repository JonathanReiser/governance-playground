import { useEffect, useState } from "react";
import { ethers } from "ethers";
import WorldRegistryABI from "../abi/WorldRegistry.json";
import NationDAOABI from "../abi/NationDAO.json";
import MetricsOracleABI from "../abi/MetricsOracle.json";
import { findLogsLowerBound, queryLogsChunked } from "../lib/onchainLogs.js";
import { SCENARIOS } from "../lib/scenarios.js";
import { ExperimentBanner } from "./ExperimentBanner";

// Same default the demo path uses (server/demoDeploy.js) — a real,
// public, free Sepolia RPC. This page needs no signer and no wallet: on-
// chain state is public, so reading it back is just a provider call.
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

const GOVERNANCE_TYPE_LABELS = [
  "Parliamentary Democracy", "Theocratic Republic", "Absolute Monarchy", "Federal Republic", "Military Junta",
];

/**
 * A shareable permalink for one deployment: `?view=<registryAddress>`,
 * optionally with `&block=<deployBlock>` (see onchainLogs.js for why).
 * Reads everything straight from Sepolia — no server, no scenario JSON,
 * no wallet — so a link to this page keeps working for anyone, forever,
 * independent of this app's own uptime, the same way an Etherscan link
 * would. That's deliberate: the whole point of "citable" is that the
 * citation shouldn't depend on this specific frontend still being alive.
 *
 * Shows what's on-chain: the five metrics, each nation's governance
 * config, AND — for any run committed via commitCycleWithNarrative()
 * (every no-wallet "watch it play out" run does this; a run from the
 * wallet-connected researcher tool via plain commitCycle() does not,
 * since that call was never changed) — every cycle's actual per-nation
 * decisions and quantum/market narrative, read back via
 * DecisionRecorded/CycleNarrativeRecorded event logs. Events are not
 * contract storage: this page finds them the same way Etherscan's own
 * "Logs" tab would, via queryFilter's getLogs, which is why this is
 * still a read-only provider call with no server involved. A run with no
 * such logs (an older run, or one made through the wallet flow) simply
 * shows none — that's the real, honest state of that run's chain
 * history, not a fetch failure.
 *
 * Deliberately read-only for EVERYONE, including whoever deployed the
 * run — running more agent cycles needs the quantum/market state
 * LiveRunPanel.jsx checkpoints to that specific browser's local storage
 * (see runHistory.js's saveContinuation), which a link can't carry. This
 * page won't offer to run anything; it has a copy-link button and says
 * so plainly instead of a silent missing feature. Keeping shared runs
 * immutable is also the point, not just a limitation: "citable" means a
 * run someone links to stays exactly what it was when they linked to it,
 * not something a stranger can go extend.

 */
export function ViewRunPage({ registryAddress, deployBlock, onBack }) {
  const [state, setState] = useState({ status: "loading" });
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission can be denied, or unavailable outright (an
      // older browser, a restrictive embed) — the URL itself is right
      // there in the address bar either way, so this never blocks
      // sharing, it just skips the one-click convenience.
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!ethers.isAddress(registryAddress)) {
        setState({ status: "error", error: "That doesn't look like a valid contract address." });
        return;
      }
      try {
        const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
        const registry = new ethers.Contract(registryAddress, WorldRegistryABI.abi, provider);

        const [scenarioName, scenarioVersion, currentCycle, totalCycles, simulationActive, oracleAddress, nationIds] =
          await Promise.all([
            registry.scenarioName(),
            registry.scenarioVersion(),
            registry.currentCycle(),
            registry.totalCycles(),
            registry.simulationActive(),
            registry.metricsOracle(),
            registry.getAllNationIds(),
          ]);

        const nations = await Promise.all(
          nationIds.map(async (id) => {
            const n = await registry.getNation(id);
            const dao = new ethers.Contract(n.daoAddress, NationDAOABI.abi, provider);
            const config = await dao.config();
            return {
              id,
              name: n.name,
              daoAddress: n.daoAddress,
              tokenAddress: n.tokenAddress,
              governanceType: GOVERNANCE_TYPE_LABELS[Number(config.governanceType)] || `Type ${config.governanceType}`,
              hardlinerPressure: Number(config.hardlinerPressure),
              reformPressure: Number(config.reformPressure),
            };
          })
        );

        let metrics = null;
        if (oracleAddress && oracleAddress !== ethers.ZeroAddress) {
          const oracle = new ethers.Contract(oracleAddress, MetricsOracleABI.abi, provider);
          const m = await oracle.getCurrentMetrics();
          metrics = {
            stability: Number(m.stability),
            conflicts: Number(m.conflicts),
            trade: Number(m.trade),
            proxy: Number(m.proxy),
            dealIntegrity: Number(m.dealIntegrity),
          };
        }

        // Event logs, not contract state. queryFilter() with no block
        // range defaults to fromBlock: 0 — which this project's public
        // RPC (and most public RPCs) rejects past a maximum span per
        // call ("exceed maximum block range: 50000" in production,
        // since Sepolia is already well past 11M blocks). `deployBlock`
        // (the `?block=` URL param, threaded through from the actual
        // deploy transaction's receipt — see server/demoDeploy.js) gives
        // an exact, free starting point for every run saved after this
        // fix shipped; a link saved before it (or hand-typed with just
        // `?view=`) falls back to a bounded backward scan instead — see
        // onchainLogs.js for why a plain binary search over eth_getCode
        // doesn't work here.
        const latestBlock = await provider.getBlockNumber();
        const fromBlock = Number.isInteger(deployBlock) && deployBlock >= 0
          ? Math.max(0, deployBlock - 2) // small buffer, not load-bearing precision
          : await findLogsLowerBound(provider, registryAddress, latestBlock);
        const [decisionLogs, narrativeLogs, startingConditionLogs] = await Promise.all([
          queryLogsChunked(registry, registry.filters.DecisionRecorded(), fromBlock, latestBlock),
          queryLogsChunked(registry, registry.filters.CycleNarrativeRecorded(), fromBlock, latestBlock),
          queryLogsChunked(registry, registry.filters.StartingConditionsApplied(), fromBlock, latestBlock),
        ]);

        // Which real proposal(s) this run actually deployed with — see
        // WorldRegistry.sol's StartingConditionsApplied event. Only
        // bootstrapConfig() ever emits it (once, at deploy time), so at
        // most one log exists; none at all means either an older run
        // (deployed before this event existed) or a run from the
        // wallet-connected researcher tool, which never emits it. Ids
        // are resolved to their real name/description by matching this
        // registry's own scenarioName/scenarioVersion against the
        // frontend's current scenario bundle — the same lookup
        // ConnectStep.jsx's "Continue" path uses for the same reason.
        const scenarioMeta = SCENARIOS.find(
          (s) => s.data.meta.name === scenarioName && s.data.meta.version === scenarioVersion
        );
        const conditionIds = startingConditionLogs[0]?.args.conditionIds || null;
        const startingConditions = conditionIds
          ? conditionIds.map((id) =>
              scenarioMeta?.data.startingConditionProposals?.find((p) => p.id === id) || { name: id }
            )
          : null;

        const cycleMap = new Map(); // cycle number -> { decisions: [], narrative }
        for (const log of decisionLogs) {
          const cycle = Number(log.args.cycle);
          if (!cycleMap.has(cycle)) cycleMap.set(cycle, { decisions: [], narrative: null });
          cycleMap.get(cycle).decisions.push({
            nationId: log.args.nationId,
            primaryAction: log.args.primaryAction,
            reasoning: log.args.reasoning,
            researchNote: log.args.researchNote,
          });
        }
        for (const log of narrativeLogs) {
          const cycle = Number(log.args.cycle);
          if (!cycleMap.has(cycle)) cycleMap.set(cycle, { decisions: [], narrative: null });
          cycleMap.get(cycle).narrative = {
            quantumSummary: log.args.quantumSummary,
            marketSummary: log.args.marketSummary,
          };
        }
        const cycles = [...cycleMap.entries()].sort((a, b) => a[0] - b[0]).map(([cycle, v]) => ({ cycle, ...v }));

        if (!cancelled) {
          setState({
            status: "ready",
            scenarioName, scenarioVersion,
            currentCycle: Number(currentCycle), totalCycles: Number(totalCycles),
            simulationActive, oracleAddress, nations, metrics, cycles, startingConditions,
            scenarioData: scenarioMeta?.data,
          });
        }
      } catch (e) {
        if (!cancelled) setState({ status: "error", error: e.message });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [registryAddress, deployBlock]);

  return (
    <div className="step-panel center-panel">
      <div className="connect-card" style={{ maxWidth: 620, margin: "0 auto" }}>
        <h2>Viewing a Real Run</h2>
        <p className="muted" style={{ fontSize: 12, fontFamily: "monospace" }}>
          <a href={`https://sepolia.etherscan.io/address/${registryAddress}`} target="_blank" rel="noopener noreferrer">
            {registryAddress}
          </a>
        </p>
        <button className="btn-secondary" style={{ fontSize: 12 }} onClick={copyLink}>
          {copied ? "✓ Copied" : "📋 Copy Link"}
        </button>
        <p className="muted" style={{ fontSize: 11, marginTop: "0.4rem" }}>
          This page is read-only for everyone, including you — it shows exactly what's on-chain,
          nothing more. Running more agent cycles on a run is only possible from the browser that
          originally deployed it, via "My Runs" on the Connect screen; a shared link can't do that,
          even for the person who made it.
        </p>

        {state.status === "loading" && <p className="muted">Reading this run's real state from Sepolia…</p>}

        {state.status === "error" && (
          <div className="error-box">
            Couldn't read this run: {state.error}
            <p className="muted" style={{ fontSize: 12, marginTop: "0.5rem" }}>
              Either the address is wrong, or the public RPC is temporarily unreachable — the
              on-chain data itself doesn't go away; check the Etherscan link above directly.
            </p>
          </div>
        )}

        {state.status === "ready" && (
          <div>
            <ExperimentBanner scenarioName={state.scenarioName} startingConditions={state.startingConditions} scenarioData={state.scenarioData} />
            <p style={{ fontSize: 14 }}>
              <strong>{state.scenarioName}</strong> <span className="muted">v{state.scenarioVersion}</span>
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Cycle {state.currentCycle} of {state.totalCycles} —{" "}
              {state.simulationActive ? "still running" : "ended"}
            </p>

            {state.metrics && (
              <div
                className="muted"
                style={{ fontSize: 12, fontFamily: "monospace", margin: "0.75rem 0", lineHeight: 1.8 }}
              >
                <div>Regional Stability: {state.metrics.stability}</div>
                <div>Deal / Status Quo Integrity: {state.metrics.dealIntegrity}</div>
                <div>Conflict Events: {state.metrics.conflicts}</div>
                <div>Trade Volume: {state.metrics.trade}</div>
                <div>Proxy Activity: {state.metrics.proxy}</div>
              </div>
            )}

            <p className="muted" style={{ fontSize: 12, marginTop: "1rem" }}>
              {state.cycles.length > 0
                ? "The five metrics above, each nation's governance config below, and — since this run committed through the no-wallet \"watch it play out\" path — the full per-cycle reasoning transcript further down, all read straight from this contract's on-chain event logs."
                : "This is exactly what's written on-chain — the five metrics above, plus each nation's governance config below. This particular run has no DecisionRecorded/CycleNarrativeRecorded event logs (it predates that feature, or was committed through the wallet-connected researcher tool's plain commitCycle path), so there's no reasoning transcript to show for it."}
            </p>

            <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {state.nations.map((n) => (
                <div key={n.id} className="muted" style={{ fontSize: 12, borderTop: "1px solid currentColor", paddingTop: "0.5rem" }}>
                  <strong>{n.name}</strong> — {n.governanceType}
                  <div>Hardliner pressure: {n.hardlinerPressure} · Reform pressure: {n.reformPressure}</div>
                  <div>
                    DAO:{" "}
                    <a href={`https://sepolia.etherscan.io/address/${n.daoAddress}`} target="_blank" rel="noopener noreferrer">
                      {n.daoAddress}
                    </a>
                  </div>
                </div>
              ))}
            </div>

            {state.oracleAddress && (
              <p className="muted" style={{ fontSize: 11, fontFamily: "monospace", marginTop: "1rem" }}>
                MetricsOracle:{" "}
                <a href={`https://sepolia.etherscan.io/address/${state.oracleAddress}`} target="_blank" rel="noopener noreferrer">
                  {state.oracleAddress}
                </a>
              </p>
            )}

            {state.cycles.length > 0 && (
              <div style={{ marginTop: "1.5rem" }}>
                <h3 style={{ fontSize: 14, marginBottom: "0.5rem" }}>Reasoning Transcript</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {state.cycles.map(({ cycle, decisions, narrative }) => (
                    <div key={cycle} className="muted" style={{ fontSize: 12, border: "1px solid currentColor", borderRadius: 4, padding: "0.6rem" }}>
                      <div style={{ fontWeight: 600, marginBottom: "0.3rem" }}>Cycle {cycle}</div>
                      {decisions.map((d, i) => {
                        const nation = state.nations.find((n) => n.id === d.nationId);
                        return (
                          <div key={i} style={{ marginBottom: "0.3rem" }}>
                            <strong>{nation?.name || d.nationId}:</strong> {d.primaryAction}
                            {d.reasoning && <div style={{ marginLeft: "0.75rem" }}>— {d.reasoning}</div>}
                            {d.researchNote && (
                              <div style={{ marginLeft: "0.75rem", fontStyle: "italic", opacity: 0.8 }}>
                                Research note: {d.researchNote}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {narrative && (
                        <div style={{ marginTop: "0.3rem", opacity: 0.9 }}>
                          {narrative.quantumSummary && <div>⚛ {narrative.quantumSummary}</div>}
                          {narrative.marketSummary && <div>📈 {narrative.marketSummary}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <button className="btn-secondary" style={{ marginTop: "1.25rem", fontSize: 12 }} onClick={onBack}>
          ← Back to Governance Playground
        </button>
      </div>
    </div>
  );
}
