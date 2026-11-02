/**
 * @module api/lib/ai/openrouterCatalog
 * @description OpenRouter's live model catalogue, mapped to what the model
 * picker and the capability check need.
 *
 * `GET https://openrouter.ai/api/v1/models` is public (no key). Each text-output
 * entry becomes `{ id, label, capabilities, pricing, contextLength }`:
 *
 *   - `tools` from `supported_parameters` containing `tools`;
 *   - `jsonMode` from `response_format` or `structured_outputs`;
 *   - `reasoning` from `reasoning` or `include_reasoning`;
 *   - `vision` from `architecture.input_modalities` containing `image`;
 *   - `streaming` is assumed for every text model.
 *
 * `reasoningSummary` is never inferred: the catalogue says nothing about it, so
 * the request shaping stays on `reasoning.effort` alone for these models.
 *
 * The mapped list is cached in Redis and served from there while fresh. When a
 * refresh fails the last copy is served instead, marked stale; only a cold
 * cache plus a failed fetch is an error.
 *
 * @important Prices arrive as USD-per-token strings and are scaled to per
 *            million. A negative price (OpenRouter's routers use `-1` for
 *            "variable") is not a price, so such a model gets `pricing: null`.
 */
import type { AiCapability } from "@nimbus/types";

/** Where the catalogue is fetched from. */
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Redis key holding the mapped list. */
export const CATALOG_CACHE_KEY = "ai:catalog:openrouter";

/** How long a cached copy is served without refetching. */
export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

/** Upper bound on a catalogue fetch. */
export const CATALOG_FETCH_TIMEOUT_MS = 10_000;

/** How long Redis keeps the last copy for the stale-fallback path. */
const CATALOG_RETENTION_SECONDS = 7 * 24 * 60 * 60;

/** One mapped catalogue entry. */
export type CatalogModel = {
  id: string;
  label: string;
  capabilities: AiCapability[];
  pricing: { inputPerMTok: number; outputPerMTok: number } | null;
  contextLength: number | null;
};

/** The catalogue plus whether it is a stale fallback. */
export type CatalogResult = { models: CatalogModel[]; stale: boolean };

/** The narrow key/value surface the cache needs; ioredis satisfies it. */
export type CatalogStore = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
  ): Promise<unknown>;
};

/** Collaborators other than the store, replaceable in tests. */
export type CatalogDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};

/** Raised when there is neither a reachable catalogue nor a cached copy. */
export class CatalogUnavailableError extends Error {
  constructor() {
    super("The OpenRouter model catalogue is unavailable");
    this.name = "CatalogUnavailableError";
  }
}

type RawModel = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
  pricing?: { prompt?: unknown; completion?: unknown };
  supported_parameters?: unknown;
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** USD-per-token string to USD per million, or null when absent or negative. */
function perMillion(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const perToken = Number(value);
  if (!Number.isFinite(perToken) || perToken < 0) return null;
  // Rounded to 6 places to drop floating-point noise from the multiplication.
  return Math.round(perToken * 1_000_000 * 1e6) / 1e6;
}

/**
 * Maps one raw catalogue entry, or `null` when it is unusable: no id, or no
 * text output (an image- or audio-only model cannot serve any feature).
 */
export function mapCatalogModel(raw: RawModel): CatalogModel | null {
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;

  const outputs = stringList(raw.architecture?.output_modalities);
  if (!outputs.includes("text")) return null;

  const params = stringList(raw.supported_parameters);
  const inputs = stringList(raw.architecture?.input_modalities);

  const capabilities: AiCapability[] = ["streaming"];
  if (params.includes("tools")) capabilities.push("tools");
  if (params.includes("response_format") || params.includes("structured_outputs")) {
    capabilities.push("jsonMode");
  }
  if (params.includes("reasoning") || params.includes("include_reasoning")) {
    capabilities.push("reasoning");
  }
  if (inputs.includes("image")) capabilities.push("vision");

  const input = perMillion(raw.pricing?.prompt);
  const output = perMillion(raw.pricing?.completion);

  return {
    id: raw.id,
    label: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : raw.id,
    capabilities,
    pricing:
      input !== null && output !== null
        ? { inputPerMTok: input, outputPerMTok: output }
        : null,
    contextLength:
      typeof raw.context_length === "number" ? raw.context_length : null,
  };
}

/** Maps a whole `/models` response body, dropping unusable entries. */
export function mapCatalogResponse(body: unknown): CatalogModel[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const models: CatalogModel[] = [];
  for (const entry of data) {
    const mapped = mapCatalogModel((entry ?? {}) as RawModel);
    if (mapped) models.push(mapped);
  }
  return models;
}

type Cached = { fetchedAt: number; models: CatalogModel[] };

async function readCache(store: CatalogStore): Promise<Cached | null> {
  try {
    const raw = await store.get(CATALOG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Cached>;
    if (typeof parsed.fetchedAt !== "number" || !Array.isArray(parsed.models)) {
      return null;
    }
    return { fetchedAt: parsed.fetchedAt, models: parsed.models };
  } catch {
    return null;
  }
}

/**
 * Returns the catalogue: the cached copy while it is under six hours old,
 * otherwise a fresh fetch, otherwise the old copy marked stale.
 *
 * @param store - Where the mapped list is cached; the shared Redis client in
 *                production. Passed in rather than imported so this module
 *                never opens a connection of its own.
 * @param deps - Test seams for the clock and `fetch`.
 * @throws CatalogUnavailableError when nothing is cached and the fetch fails.
 */
export async function getOpenRouterCatalog(
  store: CatalogStore,
  deps: CatalogDeps = {},
): Promise<CatalogResult> {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const cached = await readCache(store);
  if (cached && now() - cached.fetchedAt < CATALOG_TTL_MS) {
    return { models: cached.models, stale: false };
  }

  try {
    const response = await fetchImpl(OPENROUTER_MODELS_URL, {
      signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`catalogue responded ${response.status}`);

    const models = mapCatalogResponse(await response.json());
    if (models.length === 0) throw new Error("catalogue was empty");

    const entry: Cached = { fetchedAt: now(), models };
    // A failed cache write must not fail a request that already has its data.
    await store
      .set(CATALOG_CACHE_KEY, JSON.stringify(entry), "EX", CATALOG_RETENTION_SECONDS)
      .catch(() => undefined);
    return { models, stale: false };
  } catch {
    if (cached) return { models: cached.models, stale: true };
    throw new CatalogUnavailableError();
  }
}
