import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// Schema/migration tests run against the same throwaway stack as the API suite,
// but in their own database: see testhelpers/testDatabase.ts.
dotenv.config({
  path: fileURLToPath(new URL("../../.env.test", import.meta.url)),
});

export default defineConfig({
  test: {
    // `json-summary` is what scripts/check-coverage.mjs reads; the ratchet
    // cannot see a package that only prints to the terminal.
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    passWithNoTests: true,
    include: ["__tests__/**/*.test.ts"],
    // Creates and migrates this package's database before the workers start, so
    // the suite is runnable on its own as well as under `turbo run test`.
    globalSetup: ["./testhelpers/globalSetup.ts"],
  },
});
