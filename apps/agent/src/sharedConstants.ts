/**
 * @module agent/sharedConstants
 * @description The runtime values the worker takes from `@nimbus/types`: the
 * RPC method names the browser calls, the published voice track's name and the
 * fixed notice texts. Everything else the worker imports from that package is
 * a type and disappears at compile time.
 *
 * @important Import these from here, never directly from `@nimbus/types`.
 *            Run from source (`tsx`, as in development and the E2E suite), the
 *            worker is an ES module importing a package without
 *            `"type": "module"`, so Node loads it as CommonJS and exposes its
 *            values only on `default`; a direct named import then fails at
 *            startup even though type checks pass. The bundled build and the
 *            test runner see named exports, so both shapes are accepted.
 */
import * as nimbusTypes from "@nimbus/types";

const source =
  (nimbusTypes as typeof nimbusTypes & { default?: typeof nimbusTypes })
    .default ?? nimbusTypes;

/** RPC the browser calls while the Ask button is held or released. */
export const AGENT_RPC_ASK = source.AGENT_RPC_ASK;
/** RPC the browser calls to stop the assistant mid-answer. */
export const AGENT_RPC_STOP = source.AGENT_RPC_STOP;
/** Name of the audio track the assistant speaks on. */
export const AGENT_VOICE_TRACK = source.AGENT_VOICE_TRACK;
/** Spoken text of each budget notice, matching what chat shows. */
export const AGENT_NOTICE_TEXT = source.AGENT_NOTICE_TEXT;
