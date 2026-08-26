/**
 * Tests for runHistory.js — "My Runs" (listRuns/saveRun/removeRun) and
 * the newer "Continue this run" state (saveContinuation/getContinuation/
 * clearContinuation), both backed by localStorage. This suite runs under
 * vitest's node environment (no real DOM/window), so each test installs
 * a minimal in-memory localStorage mock on `globalThis.window` — enough
 * to exercise the module's actual get/set/remove calls, not a stand-in
 * for browser storage quirks.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  listRuns, saveRun, removeRun, clearRuns, viewUrlFor,
  getContinuation, saveContinuation, clearContinuation,
} from "../runHistory.js";

function fakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

beforeEach(() => {
  globalThis.window = { localStorage: fakeLocalStorage() };
});

describe("viewUrlFor", () => {
  it("includes block when registryBlock is present", () => {
    expect(viewUrlFor({ registryAddress: "0xAAA", registryBlock: 42 })).toBe("?view=0xAAA&block=42");
  });

  it("omits block when registryBlock is missing (an older saved run)", () => {
    expect(viewUrlFor({ registryAddress: "0xAAA" })).toBe("?view=0xAAA");
  });
});

describe("listRuns / saveRun / removeRun / clearRuns", () => {
  it("starts empty", () => {
    expect(listRuns()).toEqual([]);
  });

  it("saves a run and lists it back, newest first", () => {
    saveRun({ registryAddress: "0xAAA", scenarioName: "First" });
    saveRun({ registryAddress: "0xBBB", scenarioName: "Second" });
    const runs = listRuns();
    expect(runs.map((r) => r.registryAddress)).toEqual(["0xBBB", "0xAAA"]);
    expect(runs[0].savedAt).toBeTruthy();
  });

  it("deduplicates by registryAddress instead of creating a second entry", () => {
    saveRun({ registryAddress: "0xAAA", scenarioName: "v1" });
    saveRun({ registryAddress: "0xAAA", scenarioName: "v2" });
    const runs = listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].scenarioName).toBe("v2");
  });

  it("removeRun removes only the targeted run", () => {
    saveRun({ registryAddress: "0xAAA" });
    saveRun({ registryAddress: "0xBBB" });
    removeRun("0xAAA");
    expect(listRuns().map((r) => r.registryAddress)).toEqual(["0xBBB"]);
  });

  it("clearRuns empties the whole list", () => {
    saveRun({ registryAddress: "0xAAA" });
    clearRuns();
    expect(listRuns()).toEqual([]);
  });

  it("never throws when localStorage is unavailable", () => {
    globalThis.window = {
      get localStorage() { throw new Error("storage disabled"); },
    };
    expect(() => saveRun({ registryAddress: "0xAAA" })).not.toThrow();
    expect(listRuns()).toEqual([]);
  });
});

describe("getContinuation / saveContinuation / clearContinuation", () => {
  it("returns null for a run with no saved continuation", () => {
    expect(getContinuation("0xAAA")).toBeNull();
  });

  it("saves and reads back a continuation, stamped with updatedAt", () => {
    saveContinuation("0xAAA", { scenarioId: "middle-east-2026", cycleIndex: 2, simulationActive: true });
    const c = getContinuation("0xAAA");
    expect(c.scenarioId).toBe("middle-east-2026");
    expect(c.cycleIndex).toBe(2);
    expect(c.updatedAt).toBeTruthy();
  });

  it("overwrites the previous continuation for the same registryAddress rather than duplicating", () => {
    saveContinuation("0xAAA", { cycleIndex: 1 });
    saveContinuation("0xAAA", { cycleIndex: 2 });
    expect(getContinuation("0xAAA").cycleIndex).toBe(2);
  });

  it("keeps continuations for different runs independent", () => {
    saveContinuation("0xAAA", { cycleIndex: 1 });
    saveContinuation("0xBBB", { cycleIndex: 5 });
    expect(getContinuation("0xAAA").cycleIndex).toBe(1);
    expect(getContinuation("0xBBB").cycleIndex).toBe(5);
  });

  it("clearContinuation removes only the targeted run's continuation", () => {
    saveContinuation("0xAAA", { cycleIndex: 1 });
    saveContinuation("0xBBB", { cycleIndex: 2 });
    clearContinuation("0xAAA");
    expect(getContinuation("0xAAA")).toBeNull();
    expect(getContinuation("0xBBB").cycleIndex).toBe(2);
  });

  it("never throws when localStorage is unavailable", () => {
    globalThis.window = {
      get localStorage() { throw new Error("storage disabled"); },
    };
    expect(() => saveContinuation("0xAAA", { cycleIndex: 1 })).not.toThrow();
    expect(getContinuation("0xAAA")).toBeNull();
  });
});
