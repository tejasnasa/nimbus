import { prisma } from "@nimbus/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { sendEmail } from "./email";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    callbackURL: "/email-verified",
    sendVerificationEmail: async ({ user, url }) => {
      console.log("sendVerificationEmail called", user.email);
      console.log("RESEND_API_KEY exists:", !!process.env.RESEND_API_KEY);
      try {
        await sendEmail({
          to: user.email,
          subject: "Verify your Nimbus email address",
          text: `Click the link to verify your email: ${url}`,
        });
        console.log("email sent successfully");
      } catch (error) {
        console.error("email send error:", error);
      }
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
