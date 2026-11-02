/**
 * @module api/__tests__/unit/openrouterCatalog
 * @description The OpenRouter catalogue: mapping from a recorded `/models`
 * response, the six-hour cache, the stale fallback, and the fetch timeout.
 *
 * The cache store is an in-memory fake and `fetch` is injected, so this suite
 * touches no network and no Redis.
 */
import { describe, expect, it, vi } from "vitest";
import recorded from "../fixtures/openrouterModels.fixture.json";
import {
  CATALOG_CACHE_KEY,
  CATALOG_FETCH_TIMEOUT_MS,
  CATALOG_TTL_MS,
  CatalogUnavailableError,
  getOpenRouterCatalog,
  mapCatalogModel,
  mapCatalogResponse,
  type CatalogStore,
} from "../../lib/ai/openrouterCatalog";

const memoryStore = (): CatalogStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
      return "OK";
    },
  };
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("mapCatalogResponse", () => {
  const models = mapCatalogResponse(recorded);
  const byId = (id: string) => models.find((m) => m.id === id);

  it("maps parameters to capabilities", () => {
    expect(byId("openai/gpt-4o-mini")?.capabilities).toEqual(
      expect.arrayContaining(["streaming", "tools", "jsonMode", "vision"]),
    );
    expect(byId("openai/gpt-4o-mini")?.capabilities).not.toContain("reasoning");

    expect(byId("openai/gpt-5-mini")?.capabilities).toContain("reasoning");
  });

  it("never claims reasoningSummary, which the catalogue cannot tell", () => {
    for (const model of models) {
      expect(model.capabilities).not.toContain("reasoningSummary");
    }
  });

  it("derives reasoning from include_reasoning alone", () => {
    const only = mapCatalogModel({
      id: "x/y",
      architecture: { output_modalities: ["text"], input_modalities: ["text"] },
      supported_parameters: ["include_reasoning"],
    });

    expect(only?.capabilities).toContain("reasoning");
  });

  it("only grants vision when image is an input modality", () => {
    expect(byId("deepseek/deepseek-v4-flash")?.capabilities).not.toContain(
      "vision",
    );
    expect(byId("anthropic/claude-haiku-4.5")?.capabilities).toContain("vision");
  });

  it("converts per-token price strings to USD per million tokens", () => {
    expect(byId("openai/gpt-4o-mini")?.pricing).toEqual({
      inputPerMTok: 0.15,
      outputPerMTok: 0.6,
    });
    expect(byId("openai/gpt-5-mini")?.pricing).toEqual({
      inputPerMTok: 0.25,
      outputPerMTok: 2,
    });
  });

  it("gives a router with a negative price no pricing at all", () => {
    expect(byId("openrouter/auto")?.pricing).toBeNull();
  });

  it("keeps the label and context length", () => {
    expect(byId("openai/gpt-4o-mini")).toMatchObject({
      label: expect.stringContaining("GPT-4o"),
      contextLength: 128000,
    });
  });

  it("excludes entries that produce no text", () => {
    const mapped = mapCatalogResponse({
      data: [
        {
          id: "img/only",
          name: "Image only",
          architecture: { output_modalities: ["image"], input_modalities: ["text"] },
          pricing: { prompt: "0.000001", completion: "0.000002" },
          supported_parameters: ["tools"],
        },
        { id: "audio/only", architecture: { output_modalities: ["audio"] } },
        { id: "text/ok", architecture: { output_modalities: ["text"] } },
      ],
    });

    expect(mapped.map((m) => m.id)).toEqual(["text/ok"]);
  });

  it("tolerates a malformed body", () => {
    expect(mapCatalogResponse(null)).toEqual([]);
    expect(mapCatalogResponse({ data: "nope" })).toEqual([]);
    expect(mapCatalogResponse({ data: [null, {}, { id: 3 }] })).toEqual([]);
  });
});

describe("getOpenRouterCatalog", () => {
  it("fetches, maps and caches on a cold cache", async () => {
    const store = memoryStore();
    const fetchImpl = vi.fn(async () => jsonResponse(recorded));

    const result = await getOpenRouterCatalog(store, { fetchImpl });

    expect(result.stale).toBe(false);
    expect(result.models.length).toBeGreaterThan(5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.data.has(CATALOG_CACHE_KEY)).toBe(true);
  });

  it("serves a fresh cached copy without fetching", async () => {
    const store = memoryStore();
    const fetchImpl = vi.fn(async () => jsonResponse(recorded));
    let clock = 1_000;
    const now = () => clock;

    await getOpenRouterCatalog(store, { fetchImpl, now });
    clock += CATALOG_TTL_MS - 1;
    const second = await getOpenRouterCatalog(store, { fetchImpl, now });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.stale).toBe(false);
  });

  it("refetches once the copy is six hours old", async () => {
    const store = memoryStore();
    const fetchImpl = vi.fn(async () => jsonResponse(recorded));
    let clock = 1_000;
    const now = () => clock;

    await getOpenRouterCatalog(store, { fetchImpl, now });
    clock += CATALOG_TTL_MS;
    await getOpenRouterCatalog(store, { fetchImpl, now });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("serves the cached copy, marked stale, when the refresh fails", async () => {
    const store = memoryStore();
    let clock = 1_000;
    const now = () => clock;
    const first = await getOpenRouterCatalog(store, {
      fetchImpl: async () => jsonResponse(recorded),
      now,
    });

    clock += CATALOG_TTL_MS + 1;
    const second = await getOpenRouterCatalog(store, {
      fetchImpl: async () => jsonResponse({}, 503),
      now,
    });

    expect(second.stale).toBe(true);
    expect(second.models).toEqual(first.models);
  });

  it("throws a named error when the fetch fails and nothing is cached", async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error("network down");
    };

    await expect(
      getOpenRouterCatalog(memoryStore(), { fetchImpl }),
    ).rejects.toBeInstanceOf(CatalogUnavailableError);
  });

  it("treats an empty catalogue as a failure rather than caching it", async () => {
    const store = memoryStore();
    const fetchImpl = async () => jsonResponse({ data: [] });

    await expect(
      getOpenRouterCatalog(store, { fetchImpl }),
    ).rejects.toBeInstanceOf(CatalogUnavailableError);
    expect(store.data.size).toBe(0);
  });

  it("gives the request a ten second timeout signal", async () => {
    let signal: AbortSignal | null | undefined;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal;
      return jsonResponse(recorded);
    }) as unknown as typeof fetch;

    await getOpenRouterCatalog(memoryStore(), { fetchImpl });

    expect(CATALOG_FETCH_TIMEOUT_MS).toBe(10_000);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("falls back when the request is aborted by the timeout", async () => {
    const store = memoryStore();
    let clock = 1_000;
    const now = () => clock;
    await getOpenRouterCatalog(store, {
      fetchImpl: async () => jsonResponse(recorded),
      now,
    });

    clock += CATALOG_TTL_MS + 1;
    const timedOut = async (): Promise<Response> => {
      throw new DOMException("The operation timed out", "TimeoutError");
    };
    const result = await getOpenRouterCatalog(store, {
      fetchImpl: timedOut,
      now,
    });

    expect(result.stale).toBe(true);
  });

  it("ignores a corrupt cache entry and refetches", async () => {
    const store = memoryStore();
    store.data.set(CATALOG_CACHE_KEY, "{not json");
    const fetchImpl = vi.fn(async () => jsonResponse(recorded));

    const result = await getOpenRouterCatalog(store, { fetchImpl });

    expect(result.stale).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("still answers when the cache write fails", async () => {
    const store: CatalogStore = {
      get: async () => null,
      set: async () => {
        throw new Error("redis down");
      },
    };

    const result = await getOpenRouterCatalog(store, {
      fetchImpl: async () => jsonResponse(recorded),
    });

    expect(result.models.length).toBeGreaterThan(0);
  });
});
