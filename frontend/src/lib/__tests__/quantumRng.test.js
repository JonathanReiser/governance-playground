/**
 * Tests for quantumRng.js. Every test injects a fake `fetchImpl` — this
 * suite never makes a real network call, so it stays fast and
 * deterministic in CI regardless of ANU's API being up. The real endpoint
 * was hit manually while building this (see quantumRng.js's header) to
 * confirm the response shape these fakes reproduce.
 */
import { describe, it, expect, vi } from "vitest";
import { quantumRandomFloat } from "../quantumRng.js";

const anuResponse = (data, overrides = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ type: "uint16", length: 1, data, success: true, ...overrides }),
});

describe("quantumRandomFloat — success path", () => {
  it("converts ANU's uint16 sample to a float in [0, 1) and labels the source honestly", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(anuResponse([32768])); // midpoint of 0..65535
    const result = await quantumRandomFloat({ fetchImpl });

    expect(result.source).toBe("anu-qrng");
    expect(result.detail).toBeUndefined();
    expect(result.value).toBeCloseTo(32768 / 65536, 9);
    expect(result.value).toBeGreaterThanOrEqual(0);
    expect(result.value).toBeLessThan(1);
  });

  it("handles both range endpoints correctly (0 and 65535)", async () => {
    const low = await quantumRandomFloat({ fetchImpl: vi.fn().mockResolvedValue(anuResponse([0])) });
    expect(low.value).toBe(0);
    expect(low.source).toBe("anu-qrng");

    const high = await quantumRandomFloat({ fetchImpl: vi.fn().mockResolvedValue(anuResponse([65535])) });
    expect(high.value).toBeCloseTo(65535 / 65536, 9);
    expect(high.source).toBe("anu-qrng");
  });
});

describe("quantumRandomFloat — fallback path, every failure honestly labeled", () => {
  it("falls back on a non-ok HTTP status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const result = await quantumRandomFloat({ fetchImpl, fallbackRng: () => 0.42 });

    expect(result.source).toBe("math-random-fallback");
    expect(result.value).toBe(0.42);
    expect(result.detail).toContain("503");
  });

  it("falls back when the body doesn't say success:true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(anuResponse([100], { success: false }));
    const result = await quantumRandomFloat({ fetchImpl, fallbackRng: () => 0.42 });

    expect(result.source).toBe("math-random-fallback");
    expect(result.detail).toContain("unexpected response shape");
  });

  it("falls back when data is missing or not numeric", async () => {
    const missing = await quantumRandomFloat({
      fetchImpl: vi.fn().mockResolvedValue(anuResponse([])),
      fallbackRng: () => 0.42,
    });
    expect(missing.source).toBe("math-random-fallback");

    const nonNumeric = await quantumRandomFloat({
      fetchImpl: vi.fn().mockResolvedValue(anuResponse(["not-a-number"])),
      fallbackRng: () => 0.42,
    });
    expect(nonNumeric.source).toBe("math-random-fallback");
  });

  it("falls back when the value is out of the documented uint16 range", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(anuResponse([99999]));
    const result = await quantumRandomFloat({ fetchImpl, fallbackRng: () => 0.42 });

    expect(result.source).toBe("math-random-fallback");
    expect(result.detail).toContain("out of the expected uint16 range");
  });

  it("falls back when fetch itself throws (network error)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    const result = await quantumRandomFloat({ fetchImpl, fallbackRng: () => 0.42 });

    expect(result.source).toBe("math-random-fallback");
    expect(result.value).toBe(0.42);
    expect(result.detail).toContain("ENOTFOUND");
  });

  it("falls back when response.json() itself throws (malformed body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
    });
    const result = await quantumRandomFloat({ fetchImpl, fallbackRng: () => 0.42 });

    expect(result.source).toBe("math-random-fallback");
    expect(result.detail).toContain("Unexpected token");
  });

  it("falls back with no crash when no fetch implementation exists at all", async () => {
    // null, not undefined — undefined would trigger the parameter default
    // (global fetch) instead of exercising this no-fetch-available path.
    const result = await quantumRandomFloat({ fetchImpl: null, fallbackRng: () => 0.42 });

    expect(result.source).toBe("math-random-fallback");
    expect(result.value).toBe(0.42);
    expect(result.detail).toContain("no fetch implementation");
  });

  it("aborts and falls back if the request doesn't resolve within timeoutMs", async () => {
    const fetchImpl = vi.fn((_url, { signal } = {}) => {
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const result = await quantumRandomFloat({ fetchImpl, fallbackRng: () => 0.42, timeoutMs: 10 });

    expect(result.source).toBe("math-random-fallback");
    expect(result.value).toBe(0.42);
    expect(result.detail).toContain("timed out");
  });

  it("defaults fallbackRng to Math.random when not provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await quantumRandomFloat({ fetchImpl });

    expect(result.source).toBe("math-random-fallback");
    expect(result.value).toBeGreaterThanOrEqual(0);
    expect(result.value).toBeLessThan(1);
  });
});
