import { test as base, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Shared fixtures for the end-to-end suite.
 *
 * `page` is the workspace OWNER, authenticated via the `storageState` the
 * `setup` project writes. Tests that need a second identity — anything asserting
 * that two people see the same document — ask for `memberPage`, which opens an
 * isolated browser context for the MEMBER user.
 */

export interface E2EState {
  password: string;
  users: Record<"owner" | "member", { id: string; email: string }>;
  workspace: {
    id: string;
    slugId: number;
    inviteCode: string;
    canvasDocumentId: string;
    markdownDocumentId: string;
  };
}

/** Fixture ids written by the seed script; read once at module load. */
export const e2eState: E2EState = JSON.parse(
  readFileSync(resolve(import.meta.dirname, ".auth/e2e-state.json"), "utf8"),
);

export const test = base.extend<{ memberPage: Page }>({
  // Overriding `context` (rather than setting `use.storageState` in the config)
  // is what makes `page` the OWNER while leaving `browser.newContext()` genuinely
  // anonymous for specs that assert on signed-out behaviour.
  context: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: resolve(import.meta.dirname, ".auth/owner.json"),
    });

    await use(context);

    await context.close();
  },

  memberPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: resolve(import.meta.dirname, ".auth/member.json"),
    });
    const page = await context.newPage();

    await use(page);

    await context.close();
  },
});

export { expect };
