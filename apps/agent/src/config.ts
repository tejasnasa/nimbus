/**
 * @module agent/config
 * @description Validated environment for the agent worker.
 *
 * @important The worker talks to the Nimbus API with a shared bearer secret, so
 *            a missing or weak secret must stop the process at startup rather
 *            than surface as a stream of 401s mid-meeting. LiveKit's own
 *            variables (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`)
 *            are read by the agents framework itself, not here. The speech
 *            provider's address and key are not configuration at all: they
 *            arrive per session from the API, which is why this file has no
 *            provider settings.
 *
 * @important `AGENT_LOAD_THRESHOLD` exists for local and CI runs only. In
 *            production mode the agents framework declines every job once the
 *            host's CPU passes 70%, and a CI runner that also hosts a browser
 *            and every other service crosses that while idle, so the end-to-end
 *            suite raises it. LiveKit Cloud ignores a custom threshold, so it
 *            changes nothing there; leave it unset in deployed environments.
 */
import { z } from "zod";

const envSchema = z.object({
  NIMBUS_API_URL: z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, "")),
  NIMBUS_AGENT_SECRET: z.string().min(32),
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  /** CPU load (0 to 1, or above to never decline) past which jobs are refused. */
  AGENT_LOAD_THRESHOLD: z.coerce.number().positive().optional(),
});

/** The worker's validated settings. */
export type AgentConfig = z.infer<typeof envSchema>;

/**
 * Parses the agent's environment.
 *
 * Outside development the API origin must be HTTPS, because the bearer secret
 * and a session's voice key travel over it.
 *
 * @param env - Variable source, defaulting to `process.env`.
 * @returns The validated settings.
 * @throws When a variable is missing or malformed, naming the offending ones.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AgentConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const names = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new Error(`Invalid agent environment: ${names.join(", ")}`);
  }
  const config = parsed.data;
  if (
    config.NODE_ENV !== "development" &&
    !config.NIMBUS_API_URL.startsWith("https://")
  ) {
    throw new Error("Invalid agent environment: NIMBUS_API_URL must be https");
  }
  return config;
}

/**
 * Checks that a provider address received from the API is safe to send a key to.
 *
 * Outside development the address must be HTTPS: the session's key goes in the
 * `Authorization` header of every transcription request, and an `http://` URL
 * would send it in the clear.
 *
 * @param baseUrl - The OpenAI-compatible base URL from the redeem response.
 * @param config - The agent's settings.
 * @returns True when requests may be sent there.
 */
export function isAllowedProviderUrl(
  baseUrl: string,
  config: Pick<AgentConfig, "NODE_ENV">,
): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.protocol === "https:") return true;
    return config.NODE_ENV !== "production" && url.protocol === "http:";
  } catch {
    return false;
  }
}
