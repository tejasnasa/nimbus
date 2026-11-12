import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `json-summary` is what scripts/check-coverage.mjs reads; the ratchet
    // cannot see a package that only prints to the terminal.
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Test helpers live beside the tests; only product code is measured.
      exclude: ["__tests__/**", ...coverageConfigDefaults.exclude],
    },
    passWithNoTests: true,
    include: ["__tests__/**/*.test.ts", "src/**/*.test.ts"],
  },
});
