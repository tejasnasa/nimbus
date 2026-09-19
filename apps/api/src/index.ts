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
import { createHttpServer } from "./app";

const { httpServer } = createHttpServer();

httpServer.listen(3001, () => {
  console.log("Server is running on port 3001");
});
