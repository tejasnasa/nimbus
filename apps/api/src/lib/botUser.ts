/**
 * @module api/lib/botUser
 * @description Guarantees that Nimbus's `user` row exists, under its current name.
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
 *            real user. An existing row keeps its address and everything else,
 *            but its `name` is rewritten on every boot, so a deployment that
 *            still carries the bot's old display name picks up the new one.
 *
 * @important {@link BOT_USER_EMAIL} keeps the original `nimbusbot` spelling. It
 *            is an identity key rather than a label; do not rename it.
 */
import { prisma } from "@nimbus/db";
import { env } from "./env";

/** Display name stored on the bot's user row. */
export const BOT_USER_NAME = "Nimbus";

/** Address stored on the bot's user row. `.invalid` can never be registered. */
export const BOT_USER_EMAIL = "nimbusbot@nimbus.invalid";

/** The subset of the Prisma client {@link ensureBotUser} needs. */
export type BotUserDb = {
  user: Pick<typeof prisma.user, "upsert">;
};

/**
 * Creates the bot's user row when it is missing, and renames an existing one
 * to {@link BOT_USER_NAME}.
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
      name: BOT_USER_NAME,
      email: BOT_USER_EMAIL,
      emailVerified: true,
    },
    update: { name: BOT_USER_NAME },
  });
}
