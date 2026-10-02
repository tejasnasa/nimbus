import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import { webUrl } from "./env";

/**
 * Production smoke-suite configuration.
 *
 * @important There is deliberately no `webServer` and no `globalSetup`. The
 *            sibling `e2e/` config boots two local processes and runs a seeding
 *            script that TRUNCATEs every table it can reach; neither may be
 *            reachable from here. `./env` refuses to start unless the target is
 *            an allowlisted host over HTTPS, which is what keeps this suite from
 *            ever being pointed at a local stack by accident.
 *
 * @important Traces and video are OFF, unlike the local suite. Playwright traces
 *            record action parameters, and for a sign-in `fill` that means the
 *            production password; the workflow uploads artifacts where anyone
 *            with repository read can download them. The HTML report is the
 *            artifact. Do not enable tracing here.
 */
const configDir = import.meta.dirname;

export default defineConfig({
  testDir: configDir,
  outputDir: resolve(configDir, "test-results"),

  // One worker, because the two-context specs share a single workspace and the
  // document/canvas sync state is process-local on the server.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,

  // Zero at the top level: the journey mutates production, so a retry would
  // create a second workspace, post a second round of messages and pay for a
  // second model call. The read-only `public` project opts back in below.
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },

  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: resolve(configDir, "playwright-report") }],
      ]
    : [
        ["list"],
        ["html", { open: "never", outputFolder: resolve(configDir, "playwright-report") }],
      ],

  use: {
    baseURL: webUrl,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      // Signs both accounts in through the real form and sweeps stale
      // workspaces. Every authenticated spec depends on its stored cookies.
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      // @important Deliberately has no `dependencies`. If sign-in breaks, this
      //            is the project that still reports whether the site is up and
      //            whether the API is reachable — which is exactly the night you
      //            most need to know. Read-only, so it may retry once.
      name: "public",
      testMatch: /public\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      retries: 1,
    },
    {
      name: "authenticated",
      testMatch: /(?:journey|dependencies)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
});
