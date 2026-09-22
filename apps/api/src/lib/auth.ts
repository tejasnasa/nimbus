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
 *            construction.
 *
 * @important `trustedOrigins` is restricted to FRONTEND_URL — cross-subdomain
 *            session cookies break if these drift from the deploy domains.
 *            Requires BETTER_AUTH_URL, GOOGLE_CLIENT_ID/SECRET and FRONTEND_URL.
 *
 * @important Account deletion cascades owned workspaces.
 *            `Workspace` has no `ownerId` column — ownership lives in
 *            `WorkspaceMember.role === "OWNER"`, so the only place to learn
 *            what a user owns is the membership row, which Prisma cascades
 *            the moment `User` is deleted. The owned-workspace delete must
 *            therefore run in `beforeDelete`, while the membership rows still
 *            exist, or those workspaces become permanently ownerless — the
 *            ordering above is the whole reason the hook exists.
 *
 * @important Two consequences of `deleteUser` that the UI must respect:
 *            (1) `Message.user` is `onDelete: Cascade`, so deleting an
 *                account removes that person's chat history everywhere,
 *                leaving holes in other members' logs with no tombstone.
 *                The delete dialog must say so, not imply only the user's
 *                own data is affected.
 *            (2) `beforeDelete` is not atomic with `internalAdapter.deleteUser`
 *                — a crash between the two leaves owned workspaces deleted
 *                and the account alive. `beforeDelete` is idempotent and
 *                logs loudly on re-entry so a retry is harmless.
 */
import { prisma } from "@nimbus/db";
import { betterAuth, type User } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { cascadeOwnedWorkspaces } from "./accountDeletion";
import { resolveCookieAttributes } from "./cookieAttributes";
import { destroyAvatar } from "./cloudinary";
import { sendEmail, sendPasswordResetEmail } from "./email";

/**
 * Resolved cookie attributes for the running process. Computed once at module
 * load from `BETTER_AUTH_URL` and the optional `AUTH_COOKIE_DOMAIN`.
 */
const cookieAttributes = resolveCookieAttributes({
  baseUrl: process.env.BETTER_AUTH_URL ?? "",
  cookieDomain: process.env.AUTH_COOKIE_DOMAIN,
});

/**
 * Cascade-deletes every workspace the user is the sole OWNER of, *before*
 * better-auth's own `internalAdapter.deleteUser` cascades the membership rows
 * that record ownership. Runs as one transaction so a partial failure rolls
 * back and re-entry is harmless. Delegates the actual policy to
 * `lib/accountDeletion` so the unit tests can exercise the cascade without
 * booting better-auth.
 *
 * @important Skipped for NimbusBot. The bot is seeded as ADMIN into every
 *            workspace and cannot sign in, so the delete path should be
 *            unreachable in practice — but if it ever is reached, the bot
 *            owns no workspaces (the guard prevents mass workspace deletion)
 *            while better-auth's own delete still cascades the bot's
 *            membership and message rows.
 *
 * @param user - The user about to be deleted. The Prisma transaction runs
 *               against the shared `prisma` client, not the better-auth
 *               adapter, so the cascade is fully under our control.
 */
const beforeDelete = async (user: User): Promise<void> => {
  await cascadeOwnedWorkspaces(user);
};

/**
 * Best-effort post-deletion hook. Removes the user's Cloudinary avatar
 * asset if one exists. `destroyAvatar` swallows its own errors (logs and
 * returns), so a Cloudinary outage cannot break account deletion.
 *
 * @param user - The just-deleted user. Required by the better-auth contract;
 *               used to derive the deterministic `public_id`.
 */
const afterDelete = async (user: User): Promise<void> => {
  await destroyAvatar(user.id);
};

/** Shared better-auth instance consumed by REST middleware, socket auth, and route handlers. */
export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    // Force every other live session off when the password is reset. A
    // password reset is exactly the control a compromised account exercises,
    // and leaving the attacker's session alive would defeat the point.
    // The UI mirrors this with a default-on checkbox on the password-change
    // form and on the Google-only set-password path.
    revokeSessionsOnPasswordReset: true,
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
  user: {
    deleteUser: {
      enabled: true,
      beforeDelete,
      afterDelete,
      // Intentionally NOT setting `sendDeleteAccountVerification`. The branch
      // is unconditional: if configured, *every* delete request sends a
      // verification email and returns early — before the password check
      // and before `beforeDelete`. It would replace the inline confirmation
      // flow entirely (and add an email template + a landing route). The
      // Google-only case is handled by the freshness gate:
      // re-login yields a fresh session, and `password` re-authenticates
      // credential users.
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
