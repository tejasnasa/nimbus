/**
 * @module testhelpers/setup
 * @description Per-file setup for the API suite.
 *
 * External providers are never exercised by tests. `resend` is mocked at the
 * module boundary so sign-up and password-reset flows don't attempt real HTTP:
 * the SDK *resolves* with `{ data, error }` instead of throwing on API errors, so
 * without this every sign-up would make a live call to resend.com using
 * placeholder credentials, then discard the failure.
 */
import { vi } from "vitest";

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: vi.fn(async () => ({ data: { id: "test-email-id" }, error: null })),
    };
  },
}));
