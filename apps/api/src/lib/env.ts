/**
 * @module api/lib/env
 * @description Boot-time validation of the API's environment.
 *
 * The configuration the server cannot operate without is parsed once, here, and
 * a missing or malformed value fails the process at startup with the offending
 * variable named. Without that check a misconfigured deployment starts cleanly
 * and then fails per-request (an unset `TURN_SECRET` makes every voice call a
 * 500) or, worse, keeps serving with a feature silently degraded (an unset
 * `BOT_USERID` relabels the bot's own history as user input, so the model loses
 * the distinction between its replies and the user's).
 *
 * @important Imported for its side effect from the process entry point, ahead
 *            of the app being composed. Modules that read `process.env` keep
 *            reading it at call time rather than through {@link env}, so a
 *            value changed after boot still takes effect — this module only
 *            guarantees the state the process started with.
 */
import { z } from "zod";

/** A present, non-empty string. An empty value is as broken as an absent one. */
const required = z.string().min(1);

/**
 * The API's configuration, split by whether its absence is survivable.
 *
 * Everything in the required group is read unconditionally by the code path
 * that serves its feature, so an absent value means a broken feature rather
 * than a disabled one. The optional group covers values whose absence is
 * handled deliberately (`TURN_SERVER_URL` answers a named 500) or that nothing
 * in this app reads at all (`EXTERNAL_IP`, consumed by coturn's compose file).
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // ── Storage, auth and origin ──
  DATABASE_URL: required,
  REDIS_URL: required,
  BETTER_AUTH_SECRET: required,
  BETTER_AUTH_URL: required,
  FRONTEND_URL: required,

  // ── NimbusBot identity ──
  // The bot's own user row: workspace creation inserts it as ADMIN, bot messages
  // are persisted under it, and chat history is classified by comparing to it.
  BOT_USERID: required,

  // ── coturn ──
  TURN_SECRET: required,

  // ── Providers ──
  // The two LLM clients and the mail client are constructed unconditionally at
  // module load, so these are required even when their features go unused.
  GROQ_API_KEY: required,
  GROQ_MODEL: required,
  OPENAI_API_KEY: required,
  OPENAI_MODEL: required,
  RESEND_API_KEY: required,
  GOOGLE_CLIENT_ID: required,
  GOOGLE_CLIENT_SECRET: required,

  // ── Avatar storage (Cloudinary) ──
  // Used by the `/api/upload/avatar-signature` endpoint and the
  // post-deletion cleanup hook. Cloudinary uploads must be signed so the
  // browser can write with `overwrite: true` against a per-user
  // `public_id`; unsigned uploads cannot set `overwrite`, and we need
  // in-place replacement so a `User.image` derived from `secure_url`
  // always points at a single owned asset (plan §2.3).
  CLOUDINARY_CLOUD_NAME: required,
  CLOUDINARY_API_KEY: required,
  CLOUDINARY_API_SECRET: required,

  // ── Optional ──
  TURN_SERVER_URL: z.string().min(1).optional(),
  TURNS_SERVER_URL: z.string().min(1).optional(),
  EXTERNAL_IP: z.string().min(1).optional(),
  GROQ_CANVAS_MODEL: z.string().min(1).optional(),
  BETTER_AUTH_API_KEY: z.string().min(1).optional(),
  AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
});

/** The validated environment. */
export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates an environment.
 *
 * @param source - Environment to validate; defaults to `process.env`.
 * @returns The validated, typed environment.
 * @throws Error listing every invalid variable, so a failed boot reads as a
 *         checklist rather than as the first problem encountered.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid environment configuration:\n${details}\n` +
      "Set the missing values (see .env.example) and restart. Refusing to " +
      "start rather than serving with the affected features broken.",
    );
  }

  return result.data;
}

/** The validated environment, parsed once at import. */
export const env = parseEnv();
