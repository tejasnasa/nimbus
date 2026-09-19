/**
 * @module web/tests/components/testUtils
 * @description Shared harness pieces for component tests.
 *
 * IMPORTANT: import this module *first* in every test file. Importing it points
 * `NEXT_PUBLIC_BACKEND_URL` / `NEXT_PUBLIC_FRONTEND_URL` at the msw handlers'
 * origin, and `lib/auth-client.ts` reads the backend URL at module-load time —
 * so anything imported before this module (transitively) would build an auth
 * client with an undefined base URL and throw.
 *
 * The `preflight` handler exists because `happy-dom`'s `fetch` implements CORS:
 * every cross-origin write the app makes (POST/PUT/DELETE with a JSON body) is
 * preceded by an `OPTIONS` request that msw must answer, or the real socket
 * connect is attempted and the request fails with ECONNREFUSED.
 */
import { cleanup } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, vi } from "vitest";
import { BACKEND_URL } from "../msw/handlers";

export { BACKEND_URL };

// Testing Library only auto-registers cleanup when `afterEach` is a global,
// which this project's vitest config does not enable. Without this, rendered
// trees accumulate across tests in a file and text queries start matching
// elements from earlier tests.
afterEach(cleanup);

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;
process.env.NEXT_PUBLIC_FRONTEND_URL ??= "http://localhost:3000";

/** Frontend origin used by OAuth `callbackURL`s in the auth forms. */
export const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL;

const corsHeaders = {
  "Access-Control-Allow-Origin": FRONTEND_URL,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

/**
 * Answers the CORS preflight for every API route. Register it in `beforeEach`
 * (the global `afterEach` resets msw's handler list).
 */
export const preflight = http.options(`${BACKEND_URL}/api/*`, () =>
  new HttpResponse(null, { status: 204, headers: corsHeaders }),
);

/**
 * Installs a recording `alert` global.
 *
 * `happy-dom` does not implement `window.alert`, so the workspace hooks'
 * `alert(err.message)` error paths throw a `TypeError` instead of surfacing the
 * message. Returns the spy so tests can assert on what the user would have seen.
 */
// Annotated because the inferred type resolves to a deep vitest chunk path that
// it cannot name portably across the workspace.
export function stubAlert(): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  vi.stubGlobal("alert", spy);
  return spy;
}

/** Waits for the microtask queue so a stubbed promise settles inside `act`. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
