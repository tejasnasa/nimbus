/**
 * @module web/tests/msw/server
 * @description The msw node server, started once per test file by
 * `tests/setup.ts`. Tests narrow behaviour with `server.use(...)`, which
 * `afterEach` resets so one test's overrides cannot leak into the next.
 */
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
