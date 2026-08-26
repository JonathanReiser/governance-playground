/**
 * Tests for onchainLogs.js — findLogsLowerBound and queryLogsChunked —
 * against fake provider/contract objects, no real RPC involved. See the
 * module's own header comment for why these exist: ViewRunPage.jsx hit
 * "exceed maximum block range: 50000" in production because
 * queryFilter() with no range defaults to fromBlock: 0, and the obvious
 * fix (binary-searching eth_getCode for the deployment block) turned out
 * to fail too — "historical state ... is not available" — since the
 * public RPC is a pruned node with no archive access to old state.
 */
import { describe, it, expect, vi } from "vitest";
import { findLogsLowerBound, queryLogsChunked, MAX_BLOCK_RANGE } from "../onchainLogs.js";

// A fake provider whose eth_getLogs only returns something once the
// queried range reaches back to (or past) `activityStartBlock` — models
// a real contract whose actual event history starts at that block and
// runs to the tip, with nothing before it.
function fakeProvider(activityStartBlock) {
  return {
    getLogs: vi.fn(async ({ fromBlock, toBlock }) => (toBlock >= activityStartBlock ? [{ fromBlock, toBlock }] : [])),
  };
}

describe("findLogsLowerBound", () => {
  it("finds a lower bound covering activity that started within the first chunk", async () => {
    const provider = fakeProvider(999_990);
    const bound = await findLogsLowerBound(provider, "0xabc", 1_000_000, { maxRange: 100 });
    // First chunk [999_900, 1_000_000] is non-empty (activity started at
    // 999_990, inside it) -> scan continues one chunk further back;
    // [999_799, 999_899] is empty -> bound is 999_899 + 1.
    expect(bound).toBe(999_900);
    expect(bound).toBeLessThanOrEqual(999_990);
  });

  it("finds activity several chunks back", async () => {
    const provider = fakeProvider(700_000);
    const bound = await findLogsLowerBound(provider, "0xabc", 1_000_000, { maxRange: 100_000, maxChunks: 10 });
    expect(bound).toBeLessThanOrEqual(700_000);
    expect(provider.getLogs.mock.calls.length).toBeGreaterThan(1);
  });

  it("returns latestBlock + 1 (nothing to find) when the most recent chunk is already empty", async () => {
    const provider = fakeProvider(Infinity); // never any activity, at any range
    const bound = await findLogsLowerBound(provider, "0xabc", 1000, { maxRange: 100 });
    expect(bound).toBe(1001);
  });

  it("returns 0 when activity extends all the way back to genesis", async () => {
    const provider = fakeProvider(0);
    const bound = await findLogsLowerBound(provider, "0xabc", 500, { maxRange: 100 });
    expect(bound).toBe(0);
  });

  it("respects maxChunks — never makes more than maxChunks requests", async () => {
    const provider = fakeProvider(0); // activity "everywhere" -> would scan forever without a cap
    await findLogsLowerBound(provider, "0xabc", 10_000_000, { maxRange: 45_000, maxChunks: 5 });
    expect(provider.getLogs.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("resolves in exactly two requests for a contract whose activity is entirely within the most recent chunk — one to find it, one to confirm nothing lies before it", async () => {
    const provider = fakeProvider(999_950);
    await findLogsLowerBound(provider, "0xabc", 1_000_000, { maxRange: 45_000 });
    expect(provider.getLogs).toHaveBeenCalledTimes(2);
  });
});

describe("queryLogsChunked", () => {
  function fakeContract(logsByChunk) {
    return {
      queryFilter: vi.fn(async (filter, start, end) => logsByChunk(start, end)),
    };
  }

  it("makes a single call when the range fits under one chunk", async () => {
    const contract = fakeContract((start, end) => [{ start, end }]);
    const logs = await queryLogsChunked(contract, "filter", 100, 200);
    expect(contract.queryFilter).toHaveBeenCalledTimes(1);
    expect(contract.queryFilter).toHaveBeenCalledWith("filter", 100, 200);
    expect(logs).toEqual([{ start: 100, end: 200 }]);
  });

  it("splits a range wider than maxRange into multiple non-overlapping chunks covering it exactly", async () => {
    const contract = fakeContract((start, end) => [{ start, end }]);
    const logs = await queryLogsChunked(contract, "filter", 0, 25, 10);
    // maxRange=10 => each chunk covers 11 blocks: [0,10], [11,21], [22,25]
    expect(contract.queryFilter).toHaveBeenNthCalledWith(1, "filter", 0, 10);
    expect(contract.queryFilter).toHaveBeenNthCalledWith(2, "filter", 11, 21);
    expect(contract.queryFilter).toHaveBeenNthCalledWith(3, "filter", 22, 25);
    expect(logs).toEqual([{ start: 0, end: 10 }, { start: 11, end: 21 }, { start: 22, end: 25 }]);
  });

  it("aggregates logs from every chunk in order", async () => {
    const contract = fakeContract((start) => [`log-at-${start}`]);
    const logs = await queryLogsChunked(contract, "filter", 0, 22, 10);
    expect(logs).toEqual(["log-at-0", "log-at-11", "log-at-22"]);
  });

  it("handles fromBlock === toBlock (a single-block range) in one call", async () => {
    const contract = fakeContract((start, end) => [{ start, end }]);
    const logs = await queryLogsChunked(contract, "filter", 42, 42);
    expect(contract.queryFilter).toHaveBeenCalledTimes(1);
    expect(logs).toEqual([{ start: 42, end: 42 }]);
  });

  it("uses the exported MAX_BLOCK_RANGE by default, safely under the 50,000 cap", () => {
    expect(MAX_BLOCK_RANGE).toBeLessThan(50_000);
  });
});
