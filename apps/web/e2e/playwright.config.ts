import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
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
 *
 * @important The API is also started with `AI_TEST_BASE_URL` pointing at a local
 *            fake provider (`fake-provider.mjs`). The API honours that only when
 *            `NODE_ENV` is `test`, which `.env.test` sets, so adding a key in the
 *            AI settings spec never reaches a real provider. If you reuse an API
 *            that was started without it, that spec will fail rather than call
 *            out, because the fake key is rejected by the real provider.
 *
 * @important The voice agent runs as a third process, a real worker registered
 *            with the LiveKit dev server (never LiveKit Cloud: its URL and
 *            `devkey` credentials are set explicitly here, so nothing in the
 *            shell or in a `.env` file can redirect it). The speech provider it
 *            is handed is the same local fake, reached through the API's free
 *            voice tier with a key that tells the fake to answer with a
 *            scripted transcript.
 */
const repoRoot = resolve(import.meta.dirname, "../../..");
const testEnvPath = resolve(repoRoot, ".env.test");

/** Reads one value from the committed test env file. */
const testEnvValue = (name: string): string => {
  const line = readFileSync(testEnvPath, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is missing from .env.test`);
  return line.slice(name.length + 1).replace(/^["']|["']$/g, "");
};

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
      command: "node fake-provider.mjs",
      cwd: import.meta.dirname,
      url: "http://127.0.0.1:4010/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: "pipe",
    },
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
        // Every provider call the API makes goes to the local fake.
        AI_TEST_BASE_URL: "http://127.0.0.1:4010",
        // The free voice tier points at the fake too; the key contains `agent`,
        // which is what makes the fake answer transcription with its script.
        AI_VOICE_API_KEY: "e2e-fake-agent-voice-key",
        AI_VOICE_BASE_URL: "http://127.0.0.1:4010",
      },
    },
    {
      // The assistant's worker, joining rooms on the local media server.
      command: "npx tsx src/index.ts start",
      cwd: resolve(repoRoot, "apps/agent"),
      url: "http://127.0.0.1:8081/",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      env: {
        NODE_ENV: "development",
        LIVEKIT_URL: "ws://localhost:7880",
        LIVEKIT_API_KEY: "devkey",
        LIVEKIT_API_SECRET: "secret",
        NIMBUS_API_URL: "http://localhost:3001",
        NIMBUS_AGENT_SECRET: testEnvValue("NIMBUS_AGENT_SECRET"),
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
