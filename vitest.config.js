import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.js"],
    include: ["tests/**/*.test.js", "lib/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["lib/**/*.js", "extension.js", "prefs.js"],
      exclude: [
        "lib/prefs/**", // measured by vitest.prefs.config.js
        "lib/extension/extension-theme-manager.js", // UI-only (stylesheet management)
        "**/*.test.js",
        "**/mocks/**",
      ],
      all: true,
      // Regression ratchet (forge-fhen.8): set a few points below the measured
      // baseline (stmts/lines 92.41%, branches 86.69%, funcs 92.15%) so a drop in
      // coverage fails CI without an immediately-red build. Raise these as coverage
      // improves; do NOT lower them to make a red build pass.
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
      },
    },
  },
});
