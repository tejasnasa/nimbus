/**
 * @module agent/scripts/dispatch
 * @description Dispatches the agent to a room by name, the way the API does.
 *
 * Usage: `tsx scripts/dispatch.ts <room> [metadata-json]`. Reads
 * `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from the
 * environment.
 */
// A manual operator script, never run through turbo, so its variables are not
// declared as task inputs.
/* eslint-disable turbo/no-undeclared-env-vars */
import { AgentDispatchClient } from "livekit-server-sdk";

const [room, metadata = "{}"] = process.argv.slice(2);
const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;

if (!room || !LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error(
    "usage: dispatch.ts <room> [metadata-json] (LIVEKIT_* must be set)",
  );
  process.exit(1);
}

const client = new AgentDispatchClient(
  LIVEKIT_URL.replace(/^wss:/, "https:"),
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
);
const dispatch = await client.createDispatch(room, "nimbus", { metadata });
console.log("dispatch", dispatch.id, "room", dispatch.room);
