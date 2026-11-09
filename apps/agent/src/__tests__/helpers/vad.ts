/**
 * @module agent/__tests__/helpers/vad
 * @description Loads the real Silero model once per test file, with the
 * settings the agent itself runs with.
 */
import type { VAD } from "@livekit/agents";
import { VAD as SileroVAD } from "@livekit/agents-plugin-silero";
import { VAD_OPTIONS } from "../../vadOptions.js";

let loaded: Promise<VAD> | undefined;

/** The shared real voice activity detector. */
export function loadRealVad(): Promise<VAD> {
  loaded ??= SileroVAD.load(VAD_OPTIONS) as unknown as Promise<VAD>;
  return loaded;
}
