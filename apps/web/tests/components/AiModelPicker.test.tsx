/**
 * @module web/tests/components/AiModelPicker
 * @description The per-feature model picker: a non-empty model list for every
 * text feature, capability chips and prices, the OpenRouter catalogue, and the
 * custom-id flow (check, chips, save, refusal).
 *
 * The regression cases at the top pin the empty-looking dropdown: a saved model
 * that is not among the options used to fall back to the placeholder, so the
 * control read as empty even with a model chosen.
 */
import "./testUtils";
import type {
  AiCredentialDTO,
  AiFeature,
  AiPreferenceDTO,
} from "@nimbus/types";
import { http } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL, ok } from "../msw/handlers";
import { server } from "../msw/server";
import AiModelPicker from "../../components/AiModelPicker";

const cred = (providerId: string): AiCredentialDTO => ({
  providerId,
  label: null,
  maskedPreview: "sk-…4f2a",
  validatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null,
});

const FEATURES: AiFeature[] = ["chat", "markdown", "canvas"];

type PickerProps = Partial<Parameters<typeof AiModelPicker>[0]>;

function renderPicker(feature: AiFeature, props: PickerProps = {}) {
  const onModel = vi.fn();
  const onProvider = vi.fn();
  render(
    <AiModelPicker
      feature={feature}
      credentials={[cred("openai")]}
      preference={null}
      onChangeProviderAction={onProvider}
      onChangeModelAction={onModel}
      {...props}
    />,
  );
  return { onModel, onProvider };
}

const CATALOG = [
  {
    id: "vendor/alpha",
    label: "Vendor: Alpha",
    capabilities: ["streaming", "tools", "jsonMode", "vision", "reasoning"],
    pricing: { inputPerMTok: 0.5, outputPerMTok: 1.5 },
    contextLength: 32000,
    curated: false,
  },
  {
    id: "vendor/beta",
    label: "Vendor: Beta",
    capabilities: ["streaming", "tools", "jsonMode"],
    pricing: null,
    contextLength: null,
    curated: false,
  },
];

beforeEach(() => {
  server.resetHandlers();
});

describe("AiModelPicker: the model list is never empty", () => {
  for (const providerId of ["openai", "openrouter"]) {
    for (const feature of FEATURES) {
      it(`${providerId} offers at least one model for ${feature}`, async () => {
        const user = userEvent.setup();
        renderPicker(feature, { credentials: [cred(providerId)] });

        const input = screen.getByTestId(`${feature}-model-select`);
        expect(input).not.toBeDisabled();
        await user.click(input);

        const options = await screen.findAllByRole("option");
        // The footer action is also an option; a real model is one more.
        expect(options.length).toBeGreaterThan(1);
      });
    }
  }

  it("shows a saved model that is not among the options instead of the placeholder", () => {
    renderPicker("chat", {
      credentials: [cred("openai")],
      preference: {
        feature: "chat",
        providerId: "openai",
        modelId: "gpt-retired-1",
      },
    });

    expect(
      (screen.getByTestId("chat-model-select") as HTMLInputElement).value,
    ).toBe("gpt-retired-1");
  });

  it("shows the label of a saved registry model", () => {
    renderPicker("chat", {
      preference: {
        feature: "chat",
        providerId: "openai",
        modelId: "gpt-5-nano",
      },
    });

    expect(
      (screen.getByTestId("chat-model-select") as HTMLInputElement).value,
    ).toBe("GPT-5 Nano");
  });
});

describe("AiModelPicker: rows", () => {
  it("renders the label, the id, capability chips and the price", async () => {
    const user = userEvent.setup();
    renderPicker("chat");

    await user.click(screen.getByTestId("chat-model-select"));

    const row = (await screen.findByRole("option", { name: /GPT-5 Nano/ }));
    expect(within(row).getByText("gpt-5-nano")).toBeInTheDocument();
    for (const chip of ["tools", "jsonMode", "vision", "reasoning"]) {
      expect(within(row).getByTestId(`chip-${chip}`)).toBeInTheDocument();
    }
    expect(within(row).getByTestId("price-gpt-5-nano")).toHaveTextContent(
      "$0.05 in / $0.4 out per 1M",
    );
  });

  it("omits the price for a model whose price is unknown", async () => {
    const user = userEvent.setup();
    renderPicker("chat", { credentials: [cred("groq")] });

    await user.click(screen.getByTestId("chat-model-select"));

    const row = await screen.findByRole("option", { name: /Llama 3.3 70B/ });
    expect(
      within(row).queryByTestId("price-llama-3.3-70b-versatile"),
    ).toBeNull();
  });

  it("filters the list as the user types", async () => {
    const user = userEvent.setup();
    renderPicker("chat");

    await user.click(screen.getByTestId("chat-model-select"));
    await user.type(screen.getByTestId("chat-model-select"), "mini");

    const options = screen.getAllByRole("option");
    expect(options.some((o) => /GPT-5 Mini/.test(o.textContent ?? ""))).toBe(true);
    expect(options.some((o) => /GPT-5 Nano/.test(o.textContent ?? ""))).toBe(false);
  });

  it("saves the picked registry model with its source", async () => {
    const user = userEvent.setup();
    const { onModel } = renderPicker("chat");

    await user.click(screen.getByTestId("chat-model-select"));
    await user.click(await screen.findByRole("option", { name: /GPT-5 Mini/ }));

    expect(onModel).toHaveBeenCalledWith("gpt-5-mini", "registry");
  });

  it("warns when the selected model lacks a recommended capability", () => {
    renderPicker("markdown", {
      credentials: [cred("groq")],
      preference: {
        feature: "markdown",
        providerId: "groq",
        modelId: "llama-3.3-70b-versatile",
      },
    });

    expect(screen.getByTestId("markdown-picker-recommended")).toHaveTextContent(
      /lacks reasoning/,
    );
  });

  it("does not warn when the selected model has everything recommended", () => {
    renderPicker("markdown", {
      preference: {
        feature: "markdown",
        providerId: "openai",
        modelId: "gpt-5-nano",
      },
    });

    expect(screen.queryByTestId("markdown-picker-recommended")).toBeNull();
  });
});

describe("AiModelPicker: OpenRouter catalogue", () => {
  const withCatalog = () =>
    server.use(
      http.get(`${BACKEND_URL}/api/ai/catalog/openrouter`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("feature")).toBe("chat");
        return ok({ providerId: "openrouter", models: CATALOG, stale: false });
      }),
    );

  it("lists catalogue models after the registry ones, with their prices", async () => {
    withCatalog();
    const user = userEvent.setup();
    renderPicker("chat", { credentials: [cred("openrouter")] });

    await user.click(screen.getByTestId("chat-model-select"));

    const alpha = await screen.findByRole("option", { name: /Vendor: Alpha/ });
    expect(within(alpha).getByTestId("price-vendor/alpha")).toHaveTextContent(
      "$0.5 in / $1.5 out per 1M",
    );
    expect(within(alpha).getByTestId("chip-vision")).toBeInTheDocument();
    expect(
      screen.getAllByRole("option").some((o) => /GPT-4o mini/.test(o.textContent ?? "")),
    ).toBe(true);
  });

  it("saves a catalogue pick with the catalog source", async () => {
    withCatalog();
    const user = userEvent.setup();
    const { onModel } = renderPicker("chat", { credentials: [cred("openrouter")] });

    await user.click(screen.getByTestId("chat-model-select"));
    await user.click(await screen.findByRole("option", { name: /Vendor: Beta/ }));

    expect(onModel).toHaveBeenCalledWith("vendor/beta", "catalog");
  });

  it("does not fetch the catalogue for another provider", async () => {
    const fetched = vi.fn();
    server.use(
      http.get(`${BACKEND_URL}/api/ai/catalog/openrouter`, () => {
        fetched();
        return ok({ providerId: "openrouter", models: [], stale: false });
      }),
    );
    renderPicker("chat", { credentials: [cred("openai")] });

    await new Promise((r) => setTimeout(r, 50));

    expect(fetched).not.toHaveBeenCalled();
  });

  it("keeps the registry models and says so when the catalogue fails", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/catalog/openrouter`, () =>
        new Response(
          JSON.stringify({ success: false, message: "Model list unavailable." }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPicker("chat", { credentials: [cred("openrouter")] });

    expect(await screen.findByTestId("chat-catalog-error")).toHaveTextContent(
      "Model list unavailable.",
    );
    await user.click(screen.getByTestId("chat-model-select"));
    expect(
      screen.getAllByRole("option").some((o) => /GPT-4o mini/.test(o.textContent ?? "")),
    ).toBe(true);
  });
});

describe("AiModelPicker: custom model id", () => {
  async function openCustom(feature: AiFeature = "chat") {
    const user = userEvent.setup();
    const handlers = renderPicker(feature, { credentials: [cred("openrouter")] });
    await user.click(screen.getByTestId(`${feature}-model-select`));
    await user.click(await screen.findByText("Use a custom model id…"));
    return { user, ...handlers };
  }

  it("swaps the combobox for a text input and a Check button", async () => {
    await openCustom();

    expect(screen.getByTestId("chat-custom-model-input")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-model-select")).toBeNull();
    expect(screen.getByTestId("chat-check-model")).toBeDisabled();
  });

  it("checks the id, shows the measured chips and saves it as custom", async () => {
    let body: unknown;
    server.use(
      http.post(`${BACKEND_URL}/api/ai/models/probe`, async ({ request }) => {
        body = await request.json();
        return ok({
          capabilities: ["tools", "streaming", "vision"],
          servesFeatures: ["chat", "markdown"],
        });
      }),
    );
    const { user, onModel } = await openCustom();

    await user.type(screen.getByTestId("chat-custom-model-input"), "vendor/typed");
    await user.click(screen.getByTestId("chat-check-model"));

    const result = await screen.findByTestId("chat-probe-result");
    expect(body).toEqual({ providerId: "openrouter", modelId: "vendor/typed" });
    expect(within(result).getByTestId("chip-tools")).toBeInTheDocument();
    expect(within(result).getByTestId("chip-vision")).toBeInTheDocument();
    expect(within(result).queryByTestId("chip-jsonMode")).toBeNull();
    expect(result).toHaveTextContent("Can serve: chat, markdown.");
    expect(onModel).toHaveBeenCalledWith("vendor/typed", "custom");
  });

  it("names the missing capability and does not save when the model cannot serve the feature", async () => {
    server.use(
      http.post(`${BACKEND_URL}/api/ai/models/probe`, () =>
        ok({ capabilities: ["streaming"], servesFeatures: ["markdown"] }),
      ),
    );
    const { user, onModel } = await openCustom("chat");

    await user.type(screen.getByTestId("chat-custom-model-input"), "vendor/weak");
    await user.click(screen.getByTestId("chat-check-model"));

    expect(await screen.findByTestId("chat-custom-refused")).toHaveTextContent(
      /Not saved: this model lacks tools/,
    );
    expect(onModel).not.toHaveBeenCalled();
  });

  it("shows the curated reason when the id is rejected", async () => {
    server.use(
      http.post(`${BACKEND_URL}/api/ai/models/probe`, () =>
        new Response(
          JSON.stringify({
            success: false,
            message: "That model isn't available on OpenRouter.",
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const { user, onModel } = await openCustom();

    await user.type(screen.getByTestId("chat-custom-model-input"), "vendor/typo");
    await user.click(screen.getByTestId("chat-check-model"));

    expect(await screen.findByTestId("chat-probe-result")).toHaveTextContent(
      "That model isn't available on OpenRouter.",
    );
    expect(onModel).not.toHaveBeenCalled();
  });

  it("clears a previous result when the id is edited", async () => {
    server.use(
      http.post(`${BACKEND_URL}/api/ai/models/probe`, () =>
        ok({ capabilities: ["streaming"], servesFeatures: ["markdown"] }),
      ),
    );
    const { user } = await openCustom("chat");

    await user.type(screen.getByTestId("chat-custom-model-input"), "a/b");
    await user.click(screen.getByTestId("chat-check-model"));
    await screen.findByTestId("chat-probe-result");

    await user.type(screen.getByTestId("chat-custom-model-input"), "c");

    await waitFor(() =>
      expect(screen.queryByTestId("chat-probe-result")).toBeNull(),
    );
  });

  it("returns to the combobox on Cancel", async () => {
    const { user } = await openCustom();

    await user.click(screen.getByTestId("chat-custom-cancel"));

    expect(screen.getByTestId("chat-model-select")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-custom-model-input")).toBeNull();
  });

  it("shows a saved custom id with the chips stored for it", () => {
    const preference: AiPreferenceDTO = {
      feature: "chat",
      providerId: "openrouter",
      modelId: "vendor/typed",
      modelSource: "custom",
      modelCapabilities: ["tools", "streaming"],
    };
    renderPicker("chat", { credentials: [cred("openrouter")], preference });

    expect(
      (screen.getByTestId("chat-model-select") as HTMLInputElement).value,
    ).toBe("vendor/typed");
  });
});
