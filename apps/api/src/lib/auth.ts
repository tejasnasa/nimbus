/**
 * @module api/lib/auth
 * @description better-auth singleton: Prisma/Postgres adapter, email+password
 * with required verification, Google OAuth, and Resend-backed verification /
 * reset emails.
 *
 * @important Cookie config is production-shaped (`secure: true`,
 *            `domain: ".tejasnasa.me"`, `trustHost: true`) with `trustedOrigins`
 *            restricted to FRONTEND_URL — cross-subdomain session cookies break
 *            if these drift from the deploy domains. Requires BETTER_AUTH_URL,
 *            GOOGLE_CLIENT_ID/SECRET and FRONTEND_URL.
 */
import { prisma } from "@nimbus/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { sendEmail, sendPasswordResetEmail } from "./email";

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
      sameSite: "lax",
      secure: true,
      domain: ".tejasnasa.me",
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
