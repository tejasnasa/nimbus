/**
 * @module agent/__tests__/setup
 * @description Per-file setup: the agents framework refuses to build a voice
 * activity stream before its logger exists, and outside the worker nothing else
 * creates it.
 */
import { initializeLogger } from "@livekit/agents";

initializeLogger({ pretty: false, level: "error" });
