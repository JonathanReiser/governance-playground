import { describe, expect, it } from "vitest";
import { assignFraming, randomUint32 } from "../experiment";

describe("framing assignment", () => {
  it("uses and labels Web Crypto", () => {
    const cryptoApi = { getRandomValues: (array) => { array[0] = 3; return array; } };
    expect(assignFraming(cryptoApi)).toEqual({ order: "defense-attack", source: "web-crypto" });
  });

  it("fails closed in research mode without secure randomness", () => {
    expect(() => assignFraming(null)).toThrow(/cannot start/);
  });

  it("labels the casual fallback honestly", () => {
    expect(assignFraming(null, true).source).toBe("math-random-fallback");
  });
});

describe("policy randomization", () => {
  it("returns the labeled Web Crypto draw", () => {
    const cryptoApi = { getRandomValues: (array) => { array[0] = 42; return array; } };
    expect(randomUint32(cryptoApi)).toEqual({ value: 42, source: "web-crypto" });
  });

  it("fails closed without secure randomness when fallback is forbidden", () => {
    expect(() => randomUint32(null)).toThrow(/cannot continue/);
  });
});
