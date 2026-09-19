import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `json-summary` is what scripts/check-coverage.mjs reads; the ratchet
    // cannot see a package that only prints to the terminal.
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    passWithNoTests: true,
    include: ["__tests__/**/*.test.ts", "src/**/*.test.ts"],
  },
});
