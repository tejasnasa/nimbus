/**
 * @module api/index
 * @description Server bootstrap. All wiring lives in `src/app.ts`; this module
 * only loads env, composes the server, and starts listening.
 *
 * @important Required configuration is validated at startup by `lib/env`, which
 *            fails the process naming any missing variable. See that module for
 *            the required/optional split.
 *
 * @important Startup needs valid configuration and a reachable, migrated
 *            database: NimbusBot's user row is upserted before the server binds
 *            (see `lib/botUser`), and a failure there exits non-zero.
 *
 * @important Live meetings whose media room no longer exists are ended at boot
 *            (see `lib/meeting/lifecycle`), so a restart never strands a
 *            workspace with an assistant nobody can stop.
 *
 * @important The Redis adapter (attached in `app.ts`) is what allows
 *            multi-instance horizontal scaling — without it, rooms and
 *            broadcasts are process-local.
 */
import "dotenv/config";
// Validates required configuration before anything below is composed. Must stay
// after `dotenv/config`, which is what makes the file's values visible.
import "./lib/env";
import { auth } from "./lib/auth";
import { ensureBotUser } from "./lib/botUser";
import {
  describeCookieAttributes,
  resolveCookieAttributes,
} from "./lib/cookieAttributes";
import { createHttpServer } from "./app";
import { recoverOrphanedMeetings } from "./lib/meeting/lifecycle";

/**
 * Log the cookie attributes resolved from `BETTER_AUTH_URL` + `AUTH_COOKIE_DOMAIN`.
 * The attributes are coupled to those variables by construction; logging them
 * here is the only observable signal that the coupling landed where expected.
 */
console.log(
  `[auth] session cookie: ${describeCookieAttributes(
    resolveCookieAttributes({
      baseUrl: process.env.BETTER_AUTH_URL ?? "",
      cookieDomain: process.env.AUTH_COOKIE_DOMAIN,
    }),
  )} (baseURL=${process.env.BETTER_AUTH_URL ?? "(unset)"})`,
);

// Touching `auth` here forces the module to load now, ahead of the server
// binding, so any better-auth configuration error surfaces at boot rather than
// on the first request.
void auth;

async function main(): Promise<void> {
  await ensureBotUser();

  const { httpServer, io } = createHttpServer();

  httpServer.listen(3001, () => {
    console.log("Server is running on port 3001");
  });

  // Meetings left live by a restart or a lost webhook are ended here. Run after
  // the listener is up and never allowed to fail the boot: an unreachable media
  // server only means the sweep is skipped until the next start.
  void recoverOrphanedMeetings({ io }).catch((error: unknown) => {
    console.error(
      "[boot] Could not recover live meetings:",
      error instanceof Error ? error.name : "unknown error",
    );
  });
}

main().catch((error) => {
  console.error("[boot] Could not start the server:", error);
  process.exit(1);
});
