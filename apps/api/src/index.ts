/**
 * @module api/index
 * @description Server bootstrap. All wiring lives in `src/app.ts`; this module
 * only loads env, composes the server, and starts listening.
 *
 * @important Required configuration is validated at startup by `lib/env`, which
 *            fails the process naming any missing variable. See that module for
 *            the required/optional split.
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
import {
  describeCookieAttributes,
  resolveCookieAttributes,
} from "./lib/cookieAttributes";
import { createHttpServer } from "./app";

/**
 * Log the cookie attributes resolved from `BETTER_AUTH_URL` + `AUTH_COOKIE_DOMAIN`.
 * The attributes are coupled to those variables by construction; logging them
 * here is the only observable signal that the coupling landed where expected.
 * See errors.md #13.
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

const { httpServer } = createHttpServer();

httpServer.listen(3001, () => {
  console.log("Server is running on port 3001");
});
