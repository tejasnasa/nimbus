/**
 * @module web/e2e-prod/fixtures
 * @description Shared fixtures and locators for the production smoke suite.
 *
 * `page` is the smoke OWNER, authenticated from the `storageState` the `setup`
 * project writes. Specs that need a second identity ask for `memberPage`, which
 * opens its own context. A bare `browser.newContext()` is genuinely anonymous —
 * which only holds because the project sets no `use.storageState`: Playwright
 * merges project options into every context it creates, so a project-level
 * session would silently authenticate the specs that assert signed-out
 * behaviour.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { AUTH_DIR } from "./env";

/**
 * The credential card that owns the given heading.
 *
 * `FormSwitch` mounts the sign-in, sign-up and forgot-password cards at once and
 * swaps them with opacity, so `getByLabel("Email")` matches three fields and
 * fails strict mode. Scoping to the card is the only correct lookup; the same
 * helper exists in the local suite for the same reason.
 *
 * @param page - Page to search.
 * @param heading - Exact card heading, e.g. `"Welcome back"`.
 */
export const card = (page: Page, heading: string) =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) })
    .locator("xpath=..");

export const test = base.extend<{ memberPage: Page }>({
  context: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: `${AUTH_DIR}/owner.json`,
    });

    await use(context);

    await context.close();
  },

  memberPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: `${AUTH_DIR}/member.json`,
    });
    const page = await context.newPage();

    await use(page);

    await context.close();
  },
});

export { expect };
