import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // these are pure quantum-engine/data tests, no DOM needed
    include: ["src/**/*.test.js"],
    // quantumRandomFloat's own internal fallback timeout (quantumRng.js)
    // is 5000ms — vitest's old default per-test timeout. Several tests
    // deliberately exercise that real fallback path with no rng override
    // (see instinct.test.js, instinctWiring.test.js), so on a slower
    // runner (this repeatedly flaked on GitHub Actions, not locally) the
    // two timeouts race and the test fails on timing alone, not on its
    // actual assertions. Raising the suite-wide default well above 5000ms
    // fixes this at the root instead of tagging every affected test
    // one-by-one as the next one happens to flake.
    testTimeout: 15_000,
  },
});
