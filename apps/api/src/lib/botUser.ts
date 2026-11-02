/**
 * @module api/lib/botUser
 * @description Guarantees that NimbusBot's `user` row exists.
 *
 * Workspace creation inserts the bot as an ADMIN member, and
 * `WorkspaceMember.userId` is a foreign key to `user.id`. Nothing in the
 * migrations creates that row, because its id comes from `BOT_USERID` and a
 * migration cannot read the environment. {@link ensureBotUser} is the one place
 * the row is created, called at boot by the process entry point and by the test
 * helper that resets the database, so both paths share one implementation.
 *
 * @important Startup contract: a boot now needs valid configuration **and** a
 *            reachable, migrated database, because it writes this row. The
 *            entry point logs the cause and exits non-zero when it cannot.
 *
 * @important The upsert is keyed on `id`, not on the address. The `.invalid`
 *            TLD is reserved by RFC 2606, so the address can never belong to a
 *            real user, and a pre-existing row with this id is left untouched.
 */
import { prisma } from "@nimbus/db";
import { env } from "./env";

/** Address stored on the bot's user row. `.invalid` can never be registered. */
export const BOT_USER_EMAIL = "nimbusbot@nimbus.invalid";

/** The subset of the Prisma client {@link ensureBotUser} needs. */
export type BotUserDb = {
  user: Pick<typeof prisma.user, "upsert">;
};

/**
 * Creates the bot's user row when it is missing; a no-op when it exists.
 *
 * @param db - Prisma client to write through. Defaults to the shared client;
 *             tests pass their own pool.
 * @param botUserId - The id to ensure. Defaults to the validated `BOT_USERID`.
 * @throws Error when no id is configured, or when the write fails.
 */
export async function ensureBotUser(
  db: BotUserDb = prisma,
  botUserId: string | undefined = env.BOT_USERID,
): Promise<void> {
  if (!botUserId) {
    throw new Error("BOT_USERID is not set, so the bot user row cannot be created.");
  }

  await db.user.upsert({
    where: { id: botUserId },
    create: {
      id: botUserId,
      name: "NimbusBot",
      email: BOT_USER_EMAIL,
      emailVerified: true,
    },
    update: {},
  });
}
