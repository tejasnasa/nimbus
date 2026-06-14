import { prisma } from "@nimbus/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { sendEmail, sendPasswordResetEmail } from "./email";

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
