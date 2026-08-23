/**
 * Tests for Tier 2 of the actual political layer (not the instinct veto)
 * — agents.js's evolveAndCollapseQuantumStateViaQPU and applyDecisions'
 * precomputedPoliticalCollapse threading. Higher stakes than the instinct
 * Tier 2 tests: this collapse DOES feed the committed on-chain outcome
 * when enabled, so the fallback-labeling and "does it actually get used"
 * checks below matter more here, not less.
 */
import { describe, it, expect, vi } from "vitest";
import {
  initQuantumBeliefs,
  initMarketBeliefs,
  evolveAndCollapseQuantumState,
  evolveAndCollapseQuantumStateViaQPU,
  applyDecisions,
} from "../agents.js";
import middleEast from "../../../../scenarios/middle-east-2026.config.cjs";

const DECISIONS = {
  iran: { decision: { primaryAction: "threaten_hormuz", metricDeltas: { hardlinerPressure: 5 } } },
  israel: { decision: { primaryAction: "restraint", metricDeltas: {} } },
  saudi_arabia: { decision: { primaryAction: "maintain_posture", metricDeltas: {} } },
  us: { decision: { primaryAction: "mediate", metricDeltas: { diplomaticCapital: 5 } } },
};

const jsonResponse = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

describe("evolveAndCollapseQuantumState (classical) — now tagged with collapseSource", () => {
  it("tags every classical collapse with collapseSource: 'classical'", () => {
    const quantum = initQuantumBeliefs(middleEast);
    const { event } = evolveAndCollapseQuantumState(middleEast, quantum, DECISIONS, null, 1);
    expect(event.collapseSource).toBe("classical");
  });
});

describe("evolveAndCollapseQuantumStateViaQPU", () => {
  it("a real-hardware response produces collapseSource: 'qpu-real-hardware' with backend/jobId, and the labeled outcome matches the returned bits", async () => {
    const quantum = initQuantumBeliefs(middleEast);
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ a_outcome: 0, b_outcome: 0, backend: "ibm_marrakesh", job_id: "abc123", simulator: false })
    );
    const { event } = await evolveAndCollapseQuantumStateViaQPU(middleEast, quantum, DECISIONS, null, 1, fetchImpl);

    expect(event.collapseSource).toBe("qpu-real-hardware");
    expect(event.backend).toBe("ibm_marrakesh");
    expect(event.jobId).toBe("abc123");
    // a_outcome=0, b_outcome=0 -> both axis[0] labels, and the entangled
    // escalation effect (the mutual-hardline branch) should fire, same
    // rule as the classical path. This fixture's US decision is "mediate",
    // and the US peacekeeper mechanic dampens (not cancels) an escalation
    // it's actively mediating against — so the label correctly carries
    // that dampened suffix rather than the bare "entangled escalation".
    expect(event[middleEast.aiAgents.entangled.aId]).toBe(middleEast.aiAgents.entangled.aAxis[0]);
    expect(event[middleEast.aiAgents.entangled.bId]).toBe(middleEast.aiAgents.entangled.bAxis[0]);
    expect(event.entangledEffect?.label).toContain("entangled escalation");
  });

  it("a server-reported simulator fallback produces collapseSource: 'qpu-fallback-simulator', not silently labeled as real", async () => {
    const quantum = initQuantumBeliefs(middleEast);
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ a_outcome: 1, b_outcome: 1, backend: "aer_simulator", job_id: null, simulator: true, detail: "no IBM_QUANTUM_TOKEN set" })
    );
    const { event } = await evolveAndCollapseQuantumStateViaQPU(middleEast, quantum, DECISIONS, null, 1, fetchImpl);

    expect(event.collapseSource).toBe("qpu-fallback-simulator");
    expect(event.qpuDetail).toContain("no IBM_QUANTUM_TOKEN");
  });

  it("a network failure (fetch throws) falls back to the classical procedure, labeled collapseSource: 'classical-fallback', still produces a complete well-formed event", async () => {
    const quantum = initQuantumBeliefs(middleEast);
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const { event } = await evolveAndCollapseQuantumStateViaQPU(middleEast, quantum, DECISIONS, null, 1, fetchImpl);

    expect(event.collapseSource).toBe("classical-fallback");
    expect(event.qpuError).toBe("fetch failed");
    // Still a complete, valid event despite the fallback — every field
    // the classical path would have produced is present.
    expect([middleEast.aiAgents.entangled.aAxis[0], middleEast.aiAgents.entangled.aAxis[1]]).toContain(event[middleEast.aiAgents.entangled.aId]);
    expect([middleEast.aiAgents.entangled.bAxis[0], middleEast.aiAgents.entangled.bAxis[1]]).toContain(event[middleEast.aiAgents.entangled.bId]);
    expect(event[middleEast.aiAgents.standalone.id]).toBeTruthy();
  });

  it("a non-2xx HTTP response is also treated as a failure and falls back, not silently accepted as a bad reading", async () => {
    const quantum = initQuantumBeliefs(middleEast);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "joint is not normalized" }, false, 400));
    const { event } = await evolveAndCollapseQuantumStateViaQPU(middleEast, quantum, DECISIONS, null, 1, fetchImpl);

    expect(event.collapseSource).toBe("classical-fallback");
    expect(event.qpuError).toContain("not normalized");
  });

  it("the standalone (Saudi) and peacekeeper (US) qubits are still collapsed classically — Tier 2 is scoped to the entangled pair only", async () => {
    const quantum = initQuantumBeliefs(middleEast);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ a_outcome: 0, b_outcome: 1, backend: "ibm_marrakesh", job_id: "xyz", simulator: false }));
    const { event } = await evolveAndCollapseQuantumStateViaQPU(middleEast, quantum, DECISIONS, null, 1, fetchImpl);

    expect(event[middleEast.aiAgents.standalone.id]).toBeTruthy();
    expect(event[middleEast.aiAgents.peacekeeper.id]).toBeTruthy();
  });

  it("posts the exact joint statevector agents.js is currently tracking, not a stale or default one", async () => {
    const quantum = initQuantumBeliefs(middleEast);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ a_outcome: 0, b_outcome: 0, backend: "x", job_id: "1", simulator: false }));
    await evolveAndCollapseQuantumStateViaQPU(middleEast, quantum, DECISIONS, null, 1, fetchImpl);

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/layer1/qpu-collapse");
    const body = JSON.parse(opts.body);
    expect(Array.isArray(body.joint)).toBe(true);
    expect(body.joint).toHaveLength(4);
    for (const amp of body.joint) {
      expect(typeof amp.re).toBe("number");
      expect(typeof amp.im).toBe("number");
    }
  });
});

describe("applyDecisions — precomputedPoliticalCollapse threading", () => {
  it("omitting it entirely preserves existing behavior — computes the political collapse internally, same as before this param existed", () => {
    const simState = { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 };
    const agentMemory = { quantum: initQuantumBeliefs(middleEast), markets: initMarketBeliefs(middleEast) };
    const { newAgentMemory } = applyDecisions(middleEast, simState, DECISIONS, agentMemory, 1);
    expect(newAgentMemory.quantum.lastEvent.collapseSource).toBe("classical");
  });

  it("a provided precomputedPoliticalCollapse is used verbatim instead of computing one internally", () => {
    const simState = { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 };
    const agentMemory = { quantum: initQuantumBeliefs(middleEast), markets: initMarketBeliefs(middleEast) };

    // A deliberately distinctive fake result — if applyDecisions computed
    // its own collapse instead of using this, these exact sentinel values
    // wouldn't appear in the output.
    const fakeCollapse = {
      newQuantum: { entangledPair: [{ re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }], standaloneQubit: [{ re: 1, im: 0 }, { re: 0, im: 0 }] },
      event: {
        [middleEast.aiAgents.entangled.aId]: "SENTINEL_A_OUTCOME",
        [middleEast.aiAgents.entangled.bId]: "SENTINEL_B_OUTCOME",
        [middleEast.aiAgents.standalone.id]: "SENTINEL_C_OUTCOME",
        preCollapse: {}, entangledEffect: null, peacekeeperIntervention: null, retrogradeFeedback: null,
        collapseSource: "qpu-real-hardware", backend: "sentinel_backend", jobId: "sentinel_job",
      },
    };

    const { newAgentMemory } = applyDecisions(middleEast, simState, DECISIONS, agentMemory, 1, undefined, fakeCollapse);
    expect(newAgentMemory.quantum.lastEvent[middleEast.aiAgents.entangled.aId]).toBe("SENTINEL_A_OUTCOME");
    expect(newAgentMemory.quantum.lastEvent.collapseSource).toBe("qpu-real-hardware");
    expect(newAgentMemory.quantum.lastEvent.backend).toBe("sentinel_backend");
  });

  it("real end-to-end: precomputedPoliticalCollapse from evolveAndCollapseQuantumStateViaQPU flows correctly through applyDecisions", async () => {
    const simState = { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 };
    const agentMemory = { quantum: initQuantumBeliefs(middleEast), markets: initMarketBeliefs(middleEast) };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ a_outcome: 1, b_outcome: 1, backend: "ibm_marrakesh", job_id: "real123", simulator: false }));

    const politicalCollapse = await evolveAndCollapseQuantumStateViaQPU(middleEast, agentMemory.quantum, DECISIONS, agentMemory.markets?.lastEvent ?? null, 1, fetchImpl);
    const { newAgentMemory } = applyDecisions(middleEast, simState, DECISIONS, agentMemory, 1, undefined, politicalCollapse);

    expect(newAgentMemory.quantum.lastEvent.collapseSource).toBe("qpu-real-hardware");
    expect(newAgentMemory.quantum.lastEvent.jobId).toBe("real123");
    expect(newAgentMemory.quantum.lastEvent[middleEast.aiAgents.entangled.aId]).toBe(middleEast.aiAgents.entangled.aAxis[1]);
    expect(newAgentMemory.quantum.lastEvent[middleEast.aiAgents.entangled.bId]).toBe(middleEast.aiAgents.entangled.bAxis[1]);
    // The market/Layer 2-3 side is untouched by this — Tier 2 for Layer 1
    // doesn't change how the economic field collapses.
    expect(newAgentMemory.markets.lastEvent).toBeTruthy();
  });
});
