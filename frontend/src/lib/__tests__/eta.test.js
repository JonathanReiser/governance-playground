import { describe, it, expect } from "vitest";
import { estimateRemainingMs, formatDuration } from "../eta.js";

describe("estimateRemainingMs", () => {
  it("projects the average time-per-step across the remaining steps", () => {
    // 2 steps took 10s total (5s avg) -> 3 remaining steps ~ 15s
    expect(estimateRemainingMs(2, 5, 10_000)).toBe(15_000);
  });

  it("returns null before any step has completed (no data to average yet)", () => {
    expect(estimateRemainingMs(0, 5, 3_000)).toBeNull();
  });

  it("returns null once everything is already done", () => {
    expect(estimateRemainingMs(5, 5, 20_000)).toBeNull();
    expect(estimateRemainingMs(6, 5, 20_000)).toBeNull();
  });

  it("returns null when totalCount is falsy (unknown yet)", () => {
    expect(estimateRemainingMs(1, null, 1_000)).toBeNull();
    expect(estimateRemainingMs(1, 0, 1_000)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(59_499)).toBe("59s");
  });

  it("formats minute-plus durations as Xm Ys", () => {
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });

  it("omits the seconds part on an exact minute", () => {
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(180_000)).toBe("3m");
  });

  it("returns null for null/undefined/negative/NaN input", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(-5)).toBeNull();
    expect(formatDuration(NaN)).toBeNull();
  });
});
