import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * End-to-end configuration.
 *
 * The suite drives the real two-process stack — `apps/api` on :3001 and
 * `apps/web` on :3000 — against the throwaway Postgres/Redis from
 * `docker-compose.test.yml`, so it exercises the Socket.IO transport, the Prisma
 * schema, and the auth cookie path that unit tests necessarily stub.
 *
 * @important The API is started with `DOTENV_CONFIG_PATH` pointed at `.env.test`.
 *            Because `dotenv` reads that file *instead of* `apps/api/.env`, the
 *            suite can never reach a production database. Keep it that way.
 */
const repoRoot = resolve(import.meta.dirname, "../../..");
const testEnvPath = resolve(repoRoot, ".env.test");

export default defineConfig({
  testDir: ".",
  // A single worker keeps document/canvas state predictable: the realtime model
  // keeps per-document state in process memory, so parallel specs sharing a
  // workspace would race each other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  globalSetup: "./global-setup.ts",

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      // Mints the two storage states every other project depends on.
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      // @important Deliberately no `use.storageState` here. Playwright applies
      //            `contextOptions` to every `browser.newContext()` call, so a
      //            project-level storage state would silently authenticate the
      //            contexts that specs create to test anonymous behaviour —
      //            `/home` would render instead of redirecting. Identity comes
      //            from the fixtures instead, which makes it explicit at the
      //            point of use.
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],

  webServer: [
    {
      command: "npx tsx src/index.ts",
      cwd: resolve(repoRoot, "apps/api"),
      url: "http://localhost:3001/",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      env: {
        DOTENV_CONFIG_PATH: testEnvPath,
        // `.env.test` points Redis at the plaintext test container; the client
        // defaults to TLS otherwise and hangs without ever emitting an error.
        REDIS_TLS: "false",
      },
    },
    {
      command: "npx next dev --port 3000",
      cwd: resolve(repoRoot, "apps/web"),
      url: "http://localhost:3000/login",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "pipe",
      env: {
        // Process env wins over `apps/web/.env`, which points at the deployed API.
        NEXT_PUBLIC_BACKEND_URL: "http://localhost:3001",
        NEXT_PUBLIC_FRONTEND_URL: "http://localhost:3000",
        // One name for both readers now: the workspace helpers and `Chat` agree
        // on `NEXT_PUBLIC_BOT_USERID`.
        NEXT_PUBLIC_BOT_USERID: "test-bot-user-id",
      },
    },
  ],
});
