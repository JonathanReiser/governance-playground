import { useEffect, useState } from "react";
import { ethers } from "ethers";
import WorldRegistryABI from "../abi/WorldRegistry.json";
import NationDAOABI from "../abi/NationDAO.json";
import MetricsOracleABI from "../abi/MetricsOracle.json";

// Same default the demo path uses (server/demoDeploy.js) — a real,
// public, free Sepolia RPC. This page needs no signer and no wallet: on-
// chain state is public, so reading it back is just a provider call.
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

const GOVERNANCE_TYPE_LABELS = [
  "Parliamentary Democracy", "Theocratic Republic", "Absolute Monarchy", "Federal Republic", "Military Junta",
];

/**
 * A shareable permalink for one deployment: `?view=<registryAddress>`.
 * Reads everything straight from Sepolia — no server, no scenario JSON,
 * no wallet — so a link to this page keeps working for anyone, forever,
 * independent of this app's own uptime, the same way an Etherscan link
 * would. That's deliberate: the whole point of "citable" is that the
 * citation shouldn't depend on this specific frontend still being alive.
 *
 * Shows exactly what's actually on-chain (five metrics, each nation's
 * governance config) and nothing more — no AI reasoning, no quantum
 * narrative, none of that is written on-chain (see README's "what the
 * on-chain record actually is" section). A run this page can't fully
 * reconstruct is not a bug in this page; it's the honest boundary of what
 * "on-chain" actually covers here.
 */
export function ViewRunPage({ registryAddress, onBack }) {
  const [state, setState] = useState({ status: "loading" });

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

        if (!cancelled) {
          setState({
            status: "ready",
            scenarioName, scenarioVersion,
            currentCycle: Number(currentCycle), totalCycles: Number(totalCycles),
            simulationActive, oracleAddress, nations, metrics,
          });
        }
      } catch (e) {
        if (!cancelled) setState({ status: "error", error: e.message });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [registryAddress]);

  return (
    <div className="step-panel center-panel">
      <div className="connect-card" style={{ maxWidth: 620, margin: "0 auto" }}>
        <h2>Viewing a Real Run</h2>
        <p className="muted" style={{ fontSize: 12, fontFamily: "monospace" }}>
          <a href={`https://sepolia.etherscan.io/address/${registryAddress}`} target="_blank" rel="noopener noreferrer">
            {registryAddress}
          </a>
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
              This is exactly what's written on-chain — the five metrics above, plus each
              nation's governance config below. AI reasoning and quantum-collapse narration are
              never written on-chain (see the README's own note on what "on-chain record"
              actually covers), so this page can't show those even for a run that had them.
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
          </div>
        )}

        <button className="btn-secondary" style={{ marginTop: "1.25rem", fontSize: 12 }} onClick={onBack}>
          ← Back to Governance Playground
        </button>
      </div>
    </div>
  );
}
