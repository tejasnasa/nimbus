import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/__tests__/setup.ts"],
    // `json-summary` is what scripts/check-coverage.mjs reads; the ratchet
    // cannot see a package that only prints to the terminal.
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      // The worker bootstrap and the native track adapter need a real media
      // server; the end-to-end assistant spec is what exercises them.
      exclude: [
        "src/__tests__/**",
        "src/index.ts",
        "src/audio/trackFrames.ts",
      ],
    },
    passWithNoTests: true,
    include: ["src/**/*.test.ts", "src/__tests__/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
