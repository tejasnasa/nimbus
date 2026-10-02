/**
 * @module web/e2e-prod/env
 * @description Resolves and validates the target and credentials for the
 * production smoke suite.
 *
 * @important This suite drives — and writes to — the deployed application.
 *            Everything in this module exists so that aiming it at a local
 *            stack, or at a lookalike host, is a startup failure rather than a
 *            silent accident. Host matching is exact equality against the parsed
 *            hostname, never a substring: a substring check accepts
 *            `nimbus.tejasnasa.me.attacker.tld`. Plain HTTP is rejected outright
 *            so the suite cannot be redirected at `localhost`.
 *
 * @important Imported by the Playwright config in the runner process and by the
 *            spec and setup files in the worker processes, so `.env.smoke` is
 *            read in each. A variable already present in the environment is
 *            never overwritten, so CI secrets always win over the local file.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");

/**
 * Prefix every workspace this suite creates must carry. The janitor only ever
 * deletes workspaces matching it, so a mistake here can only leave litter — it
 * can never reach a workspace a real person made.
 */
export const SMOKE_WORKSPACE_PREFIX = "[smoke]";

/** How old a leftover smoke workspace must be before the janitor reaps it. */
export const SMOKE_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** Reads `<repoRoot>/.env.smoke`, leaving real environment variables alone. */
const loadLocalEnvFile = (): void => {
  const path = resolve(repoRoot, ".env.smoke");
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) process.env[key] = value;
  }
};

loadLocalEnvFile();

/**
 * Validates one target URL against its host allowlist.
 *
 * @param value - The raw environment value.
 * @param label - Variable name, used in the error so the fix is obvious.
 * @param allowlistKey - Variable holding a comma-separated override list.
 * @param defaultHosts - Hosts accepted when the override is unset.
 * @returns The origin, with any path or trailing slash removed.
 * @throws If the value is missing, unparseable, not HTTPS, or not allowlisted.
 */
const resolveTarget = (
  value: string | undefined,
  label: string,
  allowlistKey: string,
  defaultHosts: string,
): string => {
  if (!value) {
    throw new Error(
      `${label} is not set. Point it at the deployed site — this suite never ` +
        "defaults to a local stack.",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL: "${value}".`);
  }

  if (url.protocol !== "https:") {
    throw new Error(
      `${label} must be https, got "${url.protocol}" for host "${url.hostname}". ` +
        "The smoke suite only ever runs against the deployed site.",
    );
  }

  const allowed = (process.env[allowlistKey] ?? defaultHosts)
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  if (!allowed.includes(url.hostname)) {
    throw new Error(
      `${label} host "${url.hostname}" is not allowlisted (allowed: ` +
        `${allowed.join(", ")}). Set ${allowlistKey} to override.`,
    );
  }

  return url.origin;
};

/** The deployed web application. Required — there is no local fallback. */
export const webUrl = resolveTarget(
  process.env.SMOKE_BASE_URL,
  "SMOKE_BASE_URL",
  "SMOKE_ALLOWED_HOSTS",
  "nimbus.tejasnasa.me",
);

/**
 * The deployed API. Checked against its own allowlist because the web and API
 * hosts differ, so one shared list would reject one of them.
 */
export const apiUrl = resolveTarget(
  process.env.SMOKE_API_URL ?? "https://nimbus-api.tejasnasa.me",
  "SMOKE_API_URL",
  "SMOKE_ALLOWED_API_HOSTS",
  "nimbus-api.tejasnasa.me",
);

/** Every credential the suite needs, named here so the failure lists them all. */
const CREDENTIAL_VARS = [
  "SMOKE_USER_EMAIL",
  "SMOKE_USER_PASSWORD",
  "SMOKE_MEMBER_EMAIL",
  "SMOKE_MEMBER_PASSWORD",
] as const;

const missingCredentials = CREDENTIAL_VARS.filter((key) => !process.env[key]);

if (missingCredentials.length > 0) {
  throw new Error(
    `Missing smoke credentials: ${missingCredentials.join(", ")}. Add them as ` +
      "repository secrets for the nightly run, or to an untracked `.env.smoke` " +
      "for a local one.",
  );
}

/** The two seeded accounts, both email-verified, differing only by role. */
export const users = {
  owner: {
    email: process.env.SMOKE_USER_EMAIL as string,
    password: process.env.SMOKE_USER_PASSWORD as string,
  },
  member: {
    email: process.env.SMOKE_MEMBER_EMAIL as string,
    password: process.env.SMOKE_MEMBER_PASSWORD as string,
  },
} as const;

/** Where the `setup` project writes the minted session cookies. */
export const AUTH_DIR = resolve(import.meta.dirname, ".auth");
