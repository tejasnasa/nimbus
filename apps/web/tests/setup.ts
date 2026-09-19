/**
 * @module web/tests/setup
 * @description Shared setup for DOM-based tests.
 *
 * Registers the jest-dom matchers, unmounts whatever each test rendered, and
 * gives every test file a mocked network: `msw` intercepts `fetch`, so hooks that
 * call the API exercise realistic request/response handling without a running
 * backend. Unhandled requests are a warning rather than a crash, so a stray call
 * is visible without derailing the suite.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw/server";

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));

afterEach(() => {
  // @testing-library/react only self-registers cleanup when the test framework
  // exposes `afterEach` globally, and this config deliberately does not set
  // `globals: true`. Without this call the DOM from one test stays mounted into
  // the next, so a query can match an element a previous test rendered.
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());
