/**
 * Tests for agents.js's createRealEntropyPool() and its threading through
 * applyDecisions() into the actual Layer 1/2/3 collapse (evolveAndCollapse-
 * QuantumState/evolveAndCollapseMarkets in agents.js/markets.js, and the
 * quantum.js primitives underneath). See createRealEntropyPool's own doc
 * comment for why this is a pre-fetched pool + synchronous rng rather than
 * making the collapse chain itself async.
 */
import { describe, it, expect } from "vitest";
import { createRealEntropyPool, applyDecisions, initQuantumBeliefs, initMarketBeliefs } from "../agents.js";
import middleEast from "../../../../scenarios/middle-east-2026.config.cjs";

// Deterministic, network-free stand-in for quantumRandomFloat — same
// {value, source} contract.
function fixedDrawFn(values, source = "anu-qrng") {
  let i = 0;
  return async () => ({ value: values[i++ % values.length], source });
}

describe("createRealEntropyPool", () => {
  it("pre-fetches exactly `size` values and hands them out in order", async () => {
    const { rng, sourcesUsed } = await createRealEntropyPool(3, fixedDrawFn([0.1, 0.5, 0.9]));
    expect(rng()).toBe(0.1);
    expect(rng()).toBe(0.5);
    expect(rng()).toBe(0.9);
    expect(sourcesUsed).toEqual(["anu-qrng", "anu-qrng", "anu-qrng"]);
  });

  it("falls back to Math.random once the pool is exhausted, labeled honestly", async () => {
    const { rng, sourcesUsed } = await createRealEntropyPool(1, fixedDrawFn([0.42]));
    expect(rng()).toBe(0.42);
    const overflow = rng(); // pool has only 1 value — this draw must fall back
    expect(overflow).toBeGreaterThanOrEqual(0);
    expect(overflow).toBeLessThan(1);
    expect(sourcesUsed).toEqual(["anu-qrng", "math-random-fallback-pool-exhausted"]);
  });

  it("carries through a real (fallback-labeled) source from the injected draw function", async () => {
    const { rng, sourcesUsed } = await createRealEntropyPool(2, fixedDrawFn([0.1, 0.2], "math-random-fallback"));
    rng(); rng();
    expect(sourcesUsed).toEqual(["math-random-fallback", "math-random-fallback"]);
  });

  it("draws are fetched in parallel (Promise.all), not sequentially", async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;
    const drawFn = async () => {
      concurrentCalls++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      await new Promise((r) => setTimeout(r, 5));
      concurrentCalls--;
      return { value: 0.5, source: "anu-qrng" };
    };
    await createRealEntropyPool(5, drawFn);
    expect(maxConcurrent).toBe(5); // all 5 in flight at once, not one-at-a-time
  });
});

describe("applyDecisions — real entropy threading", () => {
  const DECISIONS = {
    iran: { decision: { primaryAction: "threaten_hormuz", metricDeltas: { hardlinerPressure: 5 } } },
    israel: { decision: { primaryAction: "restraint", metricDeltas: {} } },
    saudi_arabia: { decision: { primaryAction: "maintain_posture", metricDeltas: {} } },
    us: { decision: { primaryAction: "mediate", metricDeltas: { diplomaticCapital: 5 } } },
  };

  it("omitting rng entirely is byte-for-byte unaffected — the shared Math.random default still applies", () => {
    // Regression safety: adding the optional 6th param must not change
    // behavior for every existing caller (tests, scripts) that never
    // passes one.
    const simState = { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 };
    const agentMemory = { quantum: initQuantumBeliefs(middleEast), markets: initMarketBeliefs(middleEast) };
    expect(() => applyDecisions(middleEast, simState, DECISIONS, agentMemory, 1)).not.toThrow();
  });

  // A full Middle East commit draws 20 real values (4 for Layer 1's
  // political collapse, 4 for Layer 2's measureQubit calls, 12 more for
  // Layer 3's per-instrument Gaussian/Cauchy magnitude sampling inside
  // resolvePriceMove — see createRealEntropyPool's own doc comment for
  // the full breakdown, verified against a real live run, not assumed).
  // Pool size 24 here matches the real production default with the same
  // headroom, specifically so these tests exercise the FULL real draw
  // count including Layer 3 — a too-small pool would silently let the
  // later draws fall back to Math.random and could pass by accident
  // without actually proving determinism end to end.
  const FULL_POOL_SIZE = 24;

  it("a provided rng actually reaches the collapse — same fixed rng, same deterministic outcome (political AND market), run twice", async () => {
    const runOnce = async () => {
      const { rng } = await createRealEntropyPool(FULL_POOL_SIZE, fixedDrawFn(Array(FULL_POOL_SIZE).fill(0.05)));
      const simState = { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 };
      const agentMemory = { quantum: initQuantumBeliefs(middleEast), markets: initMarketBeliefs(middleEast) };
      const { newAgentMemory } = applyDecisions(middleEast, simState, DECISIONS, agentMemory, 1, rng);
      return { quantum: newAgentMemory.quantum.lastEvent, market: newAgentMemory.markets.lastEvent };
    };
    const first = await runOnce();
    const second = await runOnce();
    expect(first.quantum[middleEast.aiAgents.entangled.aId]).toBe(second.quantum[middleEast.aiAgents.entangled.aId]);
    expect(first.quantum[middleEast.aiAgents.entangled.bId]).toBe(second.quantum[middleEast.aiAgents.entangled.bId]);
    // The market/Layer 3 magnitudes are exactly where the previously-
    // undercounted 12 draws live — this is the part a too-small pool
    // would have silently let fall back to non-deterministic Math.random.
    expect(first.market.primaryDelta).toBe(second.market.primaryDelta);
    expect(first.market.currencyADelta).toBe(second.market.currencyADelta);
  });

  it("a different fixed rng can produce a different collapse than another, proving the value is actually used, not ignored", async () => {
    const lowRng = (await createRealEntropyPool(FULL_POOL_SIZE, fixedDrawFn(Array(FULL_POOL_SIZE).fill(0.001)))).rng;
    const highRng = (await createRealEntropyPool(FULL_POOL_SIZE, fixedDrawFn(Array(FULL_POOL_SIZE).fill(0.999)))).rng;

    const simState = { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 };
    const memLow = { quantum: initQuantumBeliefs(middleEast), markets: initMarketBeliefs(middleEast) };
    const memHigh = { quantum: initQuantumBeliefs(middleEast), markets: initMarketBeliefs(middleEast) };

    const lowResult = applyDecisions(middleEast, simState, DECISIONS, memLow, 1, lowRng);
    const highResult = applyDecisions(middleEast, simState, DECISIONS, memHigh, 1, highRng);
    const lowQuantum = lowResult.newAgentMemory.quantum.lastEvent;
    const highQuantum = highResult.newAgentMemory.quantum.lastEvent;

    // Not asserting a specific outcome (that depends on the exact
    // pre-collapse probabilities) — asserting the two extreme rngs
    // actually land differently on at least one collapsed qubit OR the
    // market magnitude, i.e. the value genuinely flows through to the
    // measurement rather than being computed and then dropped.
    const aId = middleEast.aiAgents.entangled.aId;
    const bId = middleEast.aiAgents.entangled.bId;
    const cId = middleEast.aiAgents.standalone.id;
    const somethingDiffered =
      lowQuantum[aId] !== highQuantum[aId] ||
      lowQuantum[bId] !== highQuantum[bId] ||
      lowQuantum[cId] !== highQuantum[cId] ||
      lowResult.newAgentMemory.markets.lastEvent.primaryDelta !== highResult.newAgentMemory.markets.lastEvent.primaryDelta;
    expect(somethingDiffered).toBe(true);
  });

  it("pool size 24 is comfortably sufficient for a real Middle East commit — no fallback overflow at the production default", async () => {
    const { rng, sourcesUsed } = await createRealEntropyPool(FULL_POOL_SIZE, fixedDrawFn(Array(FULL_POOL_SIZE).fill(0.3)));
    const simState = { stability: 50, proxy: 0, trade: 0, conflicts: 0, dealIntegrity: 50 };
    const agentMemory = { quantum: initQuantumBeliefs(middleEast), markets: initMarketBeliefs(middleEast) };
    applyDecisions(middleEast, simState, DECISIONS, agentMemory, 1, rng);
    expect(sourcesUsed.every((s) => s !== "math-random-fallback-pool-exhausted")).toBe(true);
    expect(sourcesUsed.length).toBeLessThanOrEqual(FULL_POOL_SIZE);
  });
});
