/**
 * @module api/lib/email
 * @description Resend-backed transactional email — account verification,
 * password reset, and the public contact form — rendered as table-based
 * dark-theme HTML. Requires RESEND_API_KEY; every send leaves from the same
 * fixed address on the domain verified with Resend. The account flows are
 * called by the better-auth config in `lib/auth.ts`.
 *
 * @important Two opposite delivery contracts live in this module on purpose,
 *            and telling them apart is the whole job of reading it. The account
 *            flows go through `deliver`, which logs a failure and returns: by
 *            the time one is sent the account row already exists, so failing
 *            the request would fail a sign-up that partly succeeded and leave
 *            the retry hitting "email already in use". `sendContactEmail`
 *            throws instead — there the email *is* the entire outcome and
 *            there is no row to recover from, so a swallowed error would
 *            report a message as delivered while it was lost. The two look
 *            alike; route a new email by the flow's needs, not by whichever
 *            one is nearer.
 */
import { CONTACT_CATEGORY_LABELS, type ContactCategory } from "@nimbus/types";
import { Resend, type CreateEmailOptions, type ErrorResponse } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

/** Every send leaves from this address, on the domain verified with Resend. */
const SENDER = "noreply@tejasnasa.me";

/**
 * How long the contact path waits for Resend before giving up.
 *
 * The SDK exposes no timeout and no abort signal — `new Resend(key)` takes no
 * options and `emails.send` accepts only query/headers — so an unresponsive
 * Resend would otherwise hold the sender's request open indefinitely.
 */
const CONTACT_SEND_TIMEOUT_MS = 10_000;

/** The fields every transactional email in this module supplies. */
type EmailPayload = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

/**
 * A contact-mail delivery failure, mapped to an HTTP status by the controller.
 *
 * `reason` is the part the status code depends on; `message` is for the log.
 */
export class ContactMailError extends Error {
  readonly reason: "timeout" | "upstream";

  constructor(reason: "timeout" | "upstream", message: string) {
    super(message);
    this.name = "ContactMailError";
    this.reason = reason;
  }
}

/**
 * Escapes a value for interpolation into the HTML part of an email.
 *
 * `&` is replaced first: doing it later would escape the ampersands the other
 * replacements introduce, turning `<` into `&amp;lt;`.
 */
const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * The shared shell every email in this module renders into.
 *
 * Kept in one place because three copies of the same table boilerplate is
 * where drift starts: a colour or footer change would reach whichever template
 * the author happened to be editing and silently miss the others.
 *
 * @param props.title - Card heading.
 * @param props.lead - Opening paragraph under the heading.
 * @param props.content - Body markup, already escaped by its builder.
 * @param props.footnote - Closing line above the copyright.
 * @returns A complete HTML document.
 */
const renderEmail = ({
  title,
  lead,
  content,
  footnote,
}: {
  title: string;
  lead: string;
  content: string;
  footnote: string;
}): string => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin: 0; padding: 0; background-color: #1c1624; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1c1624; padding: 48px 16px;">
      <tr>
        <td align="center">
          <table width="480" cellpadding="0" cellspacing="0" style="max-width: 480px; width: 100%;">
            <tr>
              <td align="center" style="padding-bottom: 32px;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="text-align: center; vertical-align: middle; padding-right: 12px;">
                      <span style="font-size: 36px; line-height: 1; display: block;">☁️</span>
                    </td>
                    <td style="vertical-align: middle;">
                      <span style="font-size: 22px; font-weight: 700; color: #f8f8f8; letter-spacing: -0.5px;">Nimbus</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background-color: #271d32; border-radius: 20px; border: 1px solid rgba(255,255,255,0.08); padding: 40px 40px 36px;">
                <p style="margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #f8f8f8; letter-spacing: -0.3px;">${title}</p>
                <p style="margin: 0 0 28px; font-size: 15px; color: #a78aba; line-height: 1.6;">
                  ${lead}
                </p>${content}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top: 28px;">
                <p style="margin: 0 0 4px; font-size: 12px; color: #4e4460;">${footnote}</p>
                <p style="margin: 0; font-size: 12px; color: #4e4460;">© 2026 Nimbus · <a href="https://nimbus.tejasnasa.me" style="color: #4e4460;">nimbus.tejasnasa.me</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

/**
 * A call-to-action button, a rule, and the same URL in copyable form.
 *
 * @param label - Button text.
 * @param url - Destination, interpolated as-is (it is built by better-auth,
 *              never from user input).
 */
const actionBlock = (label: string, url: string): string => `

                <table cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                  <tr>
                    <td style="background-color: #6d28d9; border-radius: 10px;">
                      <a href="${url}" style="display: inline-block; padding: 13px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">
                        ${label}
                      </a>
                    </td>
                  </tr>
                </table>
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                  <tr>
                    <td style="border-top: 1px solid rgba(255,255,255,0.07); height: 1px; font-size: 0;">&nbsp;</td>
                  </tr>
                </table>
                <p style="margin: 0 0 6px; font-size: 12px; color: #6b5f7a;">Or copy and paste this link into your browser:</p>
                <p style="margin: 0; font-size: 12px; color: #6d28d9; word-break: break-all;">${url}</p>`;

/**
 * The contact message and its metadata.
 *
 * Every interpolated value is escaped here, at the point of interpolation. The
 * `text` part of the same email keeps the raw values, so an escaped copy must
 * not be handed to it — see `sendContactEmail`.
 *
 * @param props - The submission, unescaped.
 */
const contactBlock = ({
  name,
  email,
  category,
  message,
}: {
  name: string;
  email: string;
  category: ContactCategory;
  message: string;
}): string => `

                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 12px; font-size: 13px;">
                  <tr>
                    <td style="padding: 3px 0; width: 96px; color: #6b5f7a;">From</td>
                    <td style="padding: 3px 0; color: #f8f8f8;">${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</td>
                  </tr>
                  <tr>
                    <td style="padding: 3px 0; color: #6b5f7a;">Category</td>
                    <td style="padding: 3px 0; color: #f8f8f8;">${escapeHtml(CONTACT_CATEGORY_LABELS[category])}</td>
                  </tr>
                </table>
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                  <tr>
                    <td style="border-top: 1px solid rgba(255,255,255,0.07); height: 1px; font-size: 0;">&nbsp;</td>
                  </tr>
                </table>
                <div style="white-space: pre-wrap; font-size: 15px; color: #f8f8f8; line-height: 1.6;">${escapeHtml(message)}</div>`;

/**
 * Sends one email, reporting a failure rather than propagating it.
 *
 * The SDK resolves with `{ data, error }` instead of throwing on API errors, so
 * an unchecked send is indistinguishable from a successful one — a
 * misconfigured `RESEND_API_KEY` silently disables both sign-up verification
 * and password reset, and the only symptom is users who cannot get in. The
 * request deliberately still succeeds: by the time a verification email is
 * sent the account row already exists, so making the send fatal would both fail
 * a sign-up that partially succeeded and leave the retry hitting "email already
 * in use". The failure is made loud here instead of made fatal.
 *
 * @param flow - Names the flow in the log line, so the two are tellable apart.
 * @param payload - Resend send payload.
 */
async function deliver(flow: string, payload: EmailPayload) {
  try {
    const { error } = await resend.emails.send(payload);
    if (!error) return;

    console.error(
      `[email] ${flow} was not delivered — check RESEND_API_KEY and the ` +
        "sender domain. The request succeeded, so the recipient got nothing.",
      error,
    );
  } catch (err) {
    // Reaching Resend at all can fail (network, DNS); same reasoning applies.
    console.error(`[email] ${flow} failed before reaching Resend:`, err);
  }
}

/**
 * Sends the password-reset email (link valid ~1h per better-auth default).
 *
 * @param props.to - Recipient address.
 * @param props.url - Fully-formed reset URL from better-auth.
 */
export async function sendPasswordResetEmail({
  to,
  url,
}: {
  to: string;
  url: string;
}) {
  await deliver("password reset", {
    from: SENDER,
    to,
    subject: "Reset your Nimbus Password",
    html: renderEmail({
      title: "Reset your password",
      lead: "We received a request to reset your Nimbus password. Click the button below to choose a new one. This link expires in 1 hour.",
      content: actionBlock("Reset Password →", url),
      footnote:
        "If you didn't request a password reset, you can safely ignore this email.",
    }),
  });
}

/**
 * Sends the signup verification email.
 *
 * @param props.to - Recipient address.
 * @param props.url - Verification URL (already rewritten to the frontend route by `lib/auth.ts`).
 */
export async function sendEmail({ to, url }: { to: string; url: string }) {
  await deliver("email verification", {
    from: SENDER,
    to,
    subject: "Verify your Nimbus Email Address",
    html: renderEmail({
      title: "Verify your email address",
      lead: "Thanks for signing up for Nimbus. Just one step left: verify your email to activate your account.",
      content: actionBlock("Verify My Email →", url),
      footnote:
        "If you didn't sign up for Nimbus, you can safely ignore this email.",
    }),
  });
}

/** Rejects when `work` has not settled within {@link CONTACT_SEND_TIMEOUT_MS}. */
const withTimeout = async <T>(work: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ContactMailError(
                "timeout",
                `Resend did not answer within ${CONTACT_SEND_TIMEOUT_MS}ms`,
              ),
            ),
          CONTACT_SEND_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Runs one Resend send, converting every failure into a {@link ContactMailError}.
 *
 * @param payload - Resend send payload.
 * @returns The SDK's `error` field, or `null` when the send succeeded.
 * @throws {ContactMailError} See {@link sendContactEmail}.
 */
const sendStrictly = async (
  payload: CreateEmailOptions,
): Promise<ErrorResponse | null> => {
  try {
    const { error } = await withTimeout(resend.emails.send(payload));
    return error;
  } catch (err) {
    if (err instanceof ContactMailError) throw err;

    // A request that never reached Resend's API carries no ErrorResponse, so
    // the error's own name is all there is to classify it by.
    const errorName = (err as { name?: string } | null)?.name;

    throw new ContactMailError(
      errorName === "TimeoutError" || errorName === "AbortError"
        ? "timeout"
        : "upstream",
      err instanceof Error ? err.message : String(err),
    );
  }
};

/**
 * Sends one contact-form submission to the operator.
 *
 * Fails loudly, unlike every other send in this module: the email is the whole
 * outcome of a contact submission, so the caller has to be able to tell the
 * sender it did not go out. See the module header for why the contracts differ.
 *
 * The subject carries no user text, so a crafted name cannot forge a subject
 * line. The message is escaped into `html` only — `text` keeps the raw value,
 * and a `white-space: pre-wrap` container preserves its newlines without the
 * escape-then-swap-`\n`-for-`<br>` two-step that a later edit would get wrong.
 *
 * @param props.to - Operator address. Read from the environment by the caller,
 *                   so this module never reads configuration itself.
 * @param props.category - Picks the subject label and the body's category row.
 * @param props.name - Submitter's name, as typed.
 * @param props.email - Submitter's address; also the `Reply-To`, so the
 *                      operator can answer directly.
 * @param props.message - The submission body.
 * @throws {ContactMailError} With `reason: "timeout"` when Resend does not
 *         answer in time, `"upstream"` for anything else.
 */
export async function sendContactEmail({
  to,
  category,
  name,
  email,
  message,
}: {
  to: string;
  category: ContactCategory;
  name: string;
  email: string;
  message: string;
}): Promise<void> {
  const label = CONTACT_CATEGORY_LABELS[category];

  const error = await sendStrictly({
    from: SENDER,
    to,
    subject: `[Nimbus Contact] ${label}`,
    replyTo: email,
    text: [
      `New ${label} submitted through the Nimbus contact form.`,
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      `Category: ${label}`,
      "",
      message,
    ].join("\n"),
    html: renderEmail({
      title: `New ${label}`,
      lead: "Someone submitted the contact form on nimbus.tejasnasa.me. Reply to this email to answer them directly.",
      content: contactBlock({ name, email, category, message }),
      footnote: "Sent by the Nimbus contact form.",
    }),
  });

  if (error) {
    // The SDK's failure union: `{ message, statusCode, name }`. Nothing here is
    // shown to the sender — the controller answers generically and logs this.
    throw new ContactMailError(
      "upstream",
      `${error.name} (${error.statusCode ?? "no status"}): ${error.message}`,
    );
  }
}
