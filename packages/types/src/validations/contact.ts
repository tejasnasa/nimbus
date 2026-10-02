/**
 * @module validations/contact
 * @description Zod schema for the public contact form, shared by the API's
 * request validation and the client's form resolver so both sides enforce the
 * same limits. The category list and its operator-facing labels live here too:
 * the mail subject and the dropdown options have to agree, and one source is
 * what keeps them agreeing.
 */

import { z } from "zod";

/** Why someone is writing in, in the order the dropdown lists them. */
export const CONTACT_CATEGORIES = [
  "bug",
  "feature",
  "question",
  "other",
] as const;

/** One of {@link CONTACT_CATEGORIES}. */
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

/**
 * Operator-facing label per category. Read by the mail subject and by the
 * dropdown's options, so a relabelled category cannot reach one and miss the
 * other.
 */
export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  bug: "Bug report",
  feature: "Feature request",
  question: "Question",
  other: "Other",
};

/**
 * Contact-form payload.
 *
 * `nimbus_hp` is the honeypot and is deliberately unconstrained. Rejecting a
 * filled value here would tip a bot off about which field caught it and would
 * block a visitor whose autofill tripped it — whether a filled field means a
 * bot is a server-side decision, taken in the controller.
 *
 * `message` is a plain `z.string()`, which permits newlines. A bug report is
 * the input this field exists to collect, and a validator that rejects line
 * feeds rejects every one of them.
 */
export const contactSchema = z.object({
  category: z.enum(CONTACT_CATEGORIES, { error: "Choose a category." }),
  name: z
    .string()
    .trim()
    .min(2, { error: "Name must be at least 2 characters." })
    .max(100, { error: "Name must be at most 100 characters." }),
  email: z.email({ error: "Enter a valid email." }).trim(),
  message: z
    .string()
    .trim()
    .min(10, { error: "Message must be at least 10 characters." })
    .max(5000, { error: "Message must be at most 5000 characters." }),
  nimbus_hp: z.string(),
});
