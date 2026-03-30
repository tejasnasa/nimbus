import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@nimbus/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
  experimental: { joins: true },
  advanced: {
    trustHost: true,
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
    },
  },
  trustedOrigins: [
    `${process.env.FRONTEND_URL}`,
    `${process.env.FRONTEND_URL_2}`,
    `${process.env.FRONTEND_URL_3}`,
  ],
  baseURL: `${process.env.BETTER_AUTH_URL}`,
  socialProviders: {
    google: {
      prompt: "select_account",
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
});
