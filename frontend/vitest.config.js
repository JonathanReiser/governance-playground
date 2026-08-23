import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // these are pure quantum-engine/data tests, no DOM needed
    include: ["src/**/*.test.js"],
  },
});
