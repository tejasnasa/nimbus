/**
 * @module api/lib/auth
 * @description better-auth singleton: Prisma/Postgres adapter, email+password
 * with required verification, Google OAuth, and Resend-backed verification /
 * reset emails.
 *
 * @important Cookie attributes are derived from `BETTER_AUTH_URL` by
 *            `lib/cookieAttributes` — `https:` base URL gets `secure: true`
 *            (and a `crossSubDomainCookies` block when `AUTH_COOKIE_DOMAIN`
 *            is set), `http:` gets neither. The resolved attributes are
 *            logged at boot so the implicit coupling is observable. Changing
 *            `BETTER_AUTH_URL` therefore changes cookie behaviour by
 *            construction. See errors.md #13.
 *
 * @important `trustedOrigins` is restricted to FRONTEND_URL — cross-subdomain
 *            session cookies break if these drift from the deploy domains.
 *            Requires BETTER_AUTH_URL, GOOGLE_CLIENT_ID/SECRET and FRONTEND_URL.
 */
import { prisma } from "@nimbus/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { resolveCookieAttributes } from "./cookieAttributes";
import { sendEmail, sendPasswordResetEmail } from "./email";

/**
 * Resolved cookie attributes for the running process. Computed once at module
 * load from `BETTER_AUTH_URL` and the optional `AUTH_COOKIE_DOMAIN`.
 */
const cookieAttributes = resolveCookieAttributes({
  baseUrl: process.env.BETTER_AUTH_URL ?? "",
  cookieDomain: process.env.AUTH_COOKIE_DOMAIN,
});

/** Shared better-auth instance consumed by REST middleware, socket auth, and route handlers. */
export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({ to: user.email, url });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    callbackURL: `${process.env.FRONTEND_URL}/email-verified`,
    sendVerificationEmail: async ({ user, url }) => {
      // NOTE: rewrite better-auth's callback to the frontend route — the raw
      // `url` points at the API, which the user should never land on directly.
      const verifyUrl = new URL(url);
      verifyUrl.searchParams.set(
        "callbackURL",
        `${process.env.FRONTEND_URL}/email-verified`,
      );
      sendEmail({
        to: user.email,
        url: verifyUrl.toString(),
      });
    },
  },
  experimental: { joins: true },
  advanced: {
    trustHost: true,
    defaultCookieAttributes: {
      // `secure` and `domain` are intentionally NOT hardcoded here — they are
      // derived from `BETTER_AUTH_URL` via `cookieAttributes`. A production
      // cookie over plain HTTP (or a localhost cookie with `Secure` + a
      // production domain) is silently broken in real browsers, so the
      // derivation must be the single source of truth.
      sameSite: cookieAttributes.sameSite,
      ...(cookieAttributes.secure ? { secure: cookieAttributes.secure } : {}),
      ...(cookieAttributes.domain ? { domain: cookieAttributes.domain } : {}),
      ...(cookieAttributes.crossSubDomainCookies
        ? {
          crossSubDomainCookies: cookieAttributes.crossSubDomainCookies,
        }
        : {}),
    },
  },
  trustedOrigins: [`${process.env.FRONTEND_URL}`],
  baseURL: `${process.env.BETTER_AUTH_URL}`,
  socialProviders: {
    google: {
      prompt: "select_account",
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
});
