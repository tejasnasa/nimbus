/**
 * @module testhelpers/setup
 * @description Per-file setup for the API suite.
 *
 * External providers are never exercised by tests. `resend` is mocked at the
 * module boundary so sign-up and password-reset flows don't attempt real HTTP:
 * the SDK *resolves* with `{ data, error }` instead of throwing on API errors, so
 * without this every sign-up would make a live call to resend.com using
 * placeholder credentials, then discard the failure.
 *
 * The mock is hoisted onto `globalThis` under a stable symbol so integration
 * tests can inspect the captured payloads (`html`, `to`, `subject`, …) without
 * reaching into `lib/email`'s private instance — the alternative of
 * `vi.spyOn` requires that instance, and it is module-scoped and not exported.
 * The unit test in `unit/email.test.ts` carries its own hoisted `sendMock`;
 * this global is the integration-test equivalent.
 */
import { vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(async () => ({ data: { id: "test-email-id" }, error: null })),
}));

(globalThis as Record<symbol, unknown>)[Symbol.for("nimbus.resend.send")] =
  sendMock;

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

/**
 * Returns the shared `resend.emails.send` mock so integration tests can
 * inspect the captured payloads (HTML, recipient, subject). `mockClear` is the
 * caller's job — there is no global reset hook here, because each integration
 * test that cares about the captured calls is expected to clear at the start
 * of the assertion it cares about, not at the start of the test (clearing on
 * every test would erase the verification-email send that `mintUser` triggers).
 */
export const getResendSendMock = () =>
  (globalThis as Record<symbol, unknown>)[
    Symbol.for("nimbus.resend.send")
  ] as ReturnType<typeof vi.fn>;
