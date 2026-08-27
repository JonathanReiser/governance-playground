/**
 * NationAgent's decideFn injection point — added so scripts/run-batch.js
 * can drive real decisions directly from Node (via server.js's own
 * decideNationAction) without a live HTTP server in between. The browser
 * path (no decideFn passed) is unit-tested nowhere in this repo already
 * (it needs either a real server or a fetch mock, same reason
 * /api/agent/decide itself has no test) — this covers only the new
 * injection point, with a plain function, no fetch involved at all.
 */
import { describe, it, expect, vi } from "vitest";
import { NationAgent } from "../agents.js";

describe("NationAgent decideFn injection", function () {
  it("decide() calls decideFn directly instead of fetch, and returns its result unchanged", async function () {
    const decideFn = vi.fn().mockResolvedValue({ nation: "iran", cycle: 1, decision: { primaryAction: "TEST" } });
    const agent = new NationAgent("iran");
    const result = await agent.decide({ cycle: 1 }, "test-scenario", decideFn);

    expect(decideFn).toHaveBeenCalledWith({ nation: "iran", worldState: { cycle: 1 }, scenarioId: "test-scenario" });
    expect(result).toEqual({ nation: "iran", cycle: 1, decision: { primaryAction: "TEST" } });
  });

  it("decide() never calls fetch when decideFn is provided", async function () {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const decideFn = vi.fn().mockResolvedValue({ decision: { primaryAction: "TEST" } });
    await new NationAgent("iran").decide({ cycle: 1 }, "test-scenario", decideFn);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("runAll() passes decideFn through to every nation and keys results by nationId", async function () {
    const scenario = { meta: { id: "test-scenario" }, nations: [{ id: "iran" }, { id: "israel" }] };
    const decideFn = vi.fn(({ nation }) => Promise.resolve({ nation, decision: { primaryAction: `ACTION_${nation.toUpperCase()}` } }));

    const results = await NationAgent.runAll(scenario, { cycle: 1 }, decideFn);

    expect(decideFn).toHaveBeenCalledTimes(2);
    expect(results.iran.decision.primaryAction).toBe("ACTION_IRAN");
    expect(results.israel.decision.primaryAction).toBe("ACTION_ISRAEL");
  });

  it("runAll() records a per-nation error rather than failing the whole batch when one decideFn call rejects", async function () {
    const scenario = { meta: { id: "test-scenario" }, nations: [{ id: "iran" }, { id: "israel" }] };
    const decideFn = vi.fn(({ nation }) =>
      nation === "iran" ? Promise.reject(new Error("model declined this decision")) : Promise.resolve({ decision: { primaryAction: "OK" } })
    );

    const results = await NationAgent.runAll(scenario, { cycle: 1 }, decideFn);

    expect(results.iran.error).toBe("model declined this decision");
    expect(results.israel.decision.primaryAction).toBe("OK");
  });
});
