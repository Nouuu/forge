import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

// FR-020: Vitest 2.1.9 checks every file of the coverage map against the global
// thresholds, so lib/prefs gets its own run and its own floor. Raise, never lower.
export default defineConfig({
  test: {
    ...base.test,
    include: ["tests/unit/prefs/**/*.test.js", "tests/regression/**/*.test.js"],
    coverage: {
      ...base.test.coverage,
      include: ["lib/prefs/**/*.js"],
      exclude: ["lib/prefs/metadata.js", "**/*.test.js", "**/mocks/**"],
      reportsDirectory: "./coverage/prefs",
      thresholds: { lines: 89, branches: 89, functions: 85, statements: 89 }, // raise as coverage grows, never lower
    },
  },
});
