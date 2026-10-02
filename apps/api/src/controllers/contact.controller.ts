/**
 * @module api/controllers/contact
 * @description The public contact form: emails one operator address and
 * persists nothing. Answers an anonymous caller, which no other REST endpoint
 * in this app does.
 *
 * @important This controller reads no session and touches no database on
 *            purpose. Resolving a better-auth session costs a Postgres read,
 *            and the contact form is the channel someone uses to report an
 *            outage — making it depend on the database would remove it exactly
 *            when it is needed. The request path does no I/O of its own beyond
 *            the send.
 */
import { contactSchema, ServerResponse } from "@nimbus/types";
import { ContactMailError, sendContactEmail } from "../lib/email";
import type { z } from "zod";

/** The success message, shared so the honeypot cannot answer differently. */
const SENT_MESSAGE = "Message sent";

/**
 * Delivers one contact submission to the operator.
 *
 * @param payload - The validated request body.
 * @returns 200 once the mail is accepted by the provider, 503 when the route is
 *          unconfigured, 504 when the provider timed out, 502 otherwise.
 */
export const submitContact = async (
  payload: z.infer<typeof contactSchema>,
): Promise<ServerResponse> => {
  // A filled honeypot means a bot reached a field no human can see. The answer
  // is the same envelope the real path returns, from the same expression, so
  // the bot learns nothing about which field caught it and the two cannot
  // drift apart. The log line is the only signal, and it is what makes an
  // autofill false positive diagnosable against a "did my message arrive?"
  // report.
  if (payload.nimbus_hp !== "") {
    console.warn(
      `[contact] honeypot filled — submission discarded at ${new Date().toISOString()}`,
    );
    return ServerResponse.ok(null, SENT_MESSAGE);
  }

  // Read at call time, not through `lib/env`'s parsed object, so a value
  // changed after boot takes effect.
  const to = process.env.CONTACT_TO_EMAIL;

  if (!to) {
    console.error(
      "[contact] CONTACT_TO_EMAIL is not set — the submission was discarded.",
    );
    return ServerResponse.serviceUnavailable(
      "The contact form is unavailable right now.",
    );
  }

  try {
    await sendContactEmail({
      to,
      category: payload.category,
      name: payload.name,
      email: payload.email,
      message: payload.message,
    });
  } catch (error) {
    const reason = error instanceof ContactMailError ? error.reason : "upstream";

    // The provider's own message goes to the log only. The sender is told the
    // same thing either way, because a Resend error code is not something they
    // can act on.
    console.error(`[contact] delivery failed (${reason}):`, error);

    return reason === "timeout"
      ? ServerResponse.gatewayTimeout(
          "Could not send your message. Please try again.",
        )
      : ServerResponse.badGateway(
          "Could not send your message. Please try again.",
        );
  }

  return ServerResponse.ok(null, SENT_MESSAGE);
};
