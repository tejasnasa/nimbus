import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

const envPath = fileURLToPath(new URL("../../.env.test", import.meta.url));
const { parsed } = dotenv.config({ path: envPath });

if (!parsed) {
  throw new Error(
    `Test environment file not found at ${envPath}. It is committed at the repo root.`,
  );
}

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the shared database package to source, so tests exercise the
      // working tree rather than a possibly-stale packages/database/dist build.
      "@nimbus/db": fileURLToPath(
        new URL("../../packages/database/src/index.ts", import.meta.url),
      ),
      // Test dirs sit at varying depths (smoke/, integration/http/, …), so the
      // harness is addressed by name rather than by counting `../`.
      "@testhelpers": fileURLToPath(
        new URL("./testhelpers/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    setupFiles: ["./testhelpers/setup.ts"],
    coverage: {
      provider: "v8",
      // `json-summary` is what the ratchet script reads; `text` is for humans.
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/generated/**"],
    },
    // lib/auth.ts and lib/redis.ts read env at import time, so this must be in
    // place before any test file (and its imports) is evaluated.
    env: {
      ...parsed,
      // docker-compose.test.yml serves plaintext Redis. TLS is the production
      // default; see the note in src/lib/redis.ts.
      REDIS_TLS: "false",
    },
    // These suites drive a real HTTP/Socket.IO server against a real Postgres and
    // Redis, and truncate shared tables between tests — parallel files would race.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Suites are sharded by directory so CI can run a subset by path, e.g.
    //   npx vitest run src/__tests__/smoke
    // Empty projects are expected while the later suites are still being built.
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: { name: "smoke", include: ["src/__tests__/smoke/**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "unit", include: ["src/__tests__/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/__tests__/integration/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "security",
          include: ["src/__tests__/security/**/*.test.ts"],
        },
      },
    ],
  },
});
