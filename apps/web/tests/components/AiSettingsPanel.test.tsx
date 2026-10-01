/**
 * @module web/tests/components/AiSettingsPanel
 * @description Account-settings "AI" tab body: free-tier summary line,
 * credential list with masked previews, add/replace/remove, and per-feature
 * provider/model pickers.
 *
 * Phase 8 wired three hooks (`useAiStatus`, `useAiCredentials`,
 * `useAiPreferences`) into a single panel. The tests pin the contract:
 *
 * - **Free-tier copy**: shows the right line for each `freeTierState`.
 * - **Credential list**: renders `maskedPreview`, hides the key, hides the
 *   add-key affordance when `byokAvailable === false`.
 * - **Pickers**: the per-feature `<select>`s are wired to the hook's save.
 * - **Add flow**: opening the dialog, the save lands, the credentials list
 *   refreshes, and the panel re-renders with the new row.
 *
 * The panel uses the MSW default handlers in `tests/msw/handlers.ts` for the
 * happy path, layering overrides with `server.use(...)` to exercise the
 * failure / shape branches.
 */
import "./testUtils";
import type { AiStatusDTO } from "@nimbus/types";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { BACKEND_URL, ok } from "../msw/handlers";
import { server } from "../msw/server";
import AiSettingsPanel from "../../components/AiSettingsPanel";

/** The initial seed matches the default MSW handler for `/api/ai/status`. */
const BASE_STATUS: AiStatusDTO = {
  byokAvailable: true,
  chat: { enabled: true, providerId: null, modelId: null, substituted: false },
  documents: {
    markdown: {
      enabled: true,
      providerId: null,
      modelId: null,
      substituted: false,
    },
    canvas: {
      enabled: true,
      providerId: null,
      modelId: null,
      substituted: false,
    },
    freeRemaining: 5,
    freeLimit: 5,
    freeTierState: "available",
  },
  credentials: [],
  preferences: { chat: null, markdown: null, canvas: null },
};

beforeEach(() => {
  server.resetHandlers();
});

describe("AiSettingsPanel — free-tier summary", () => {
  it("renders the available-state copy when the free tier is fresh", () => {
    render(<AiSettingsPanel initialStatus={BASE_STATUS} />);

    expect(screen.getByTestId("free-tier-available")).toHaveTextContent(
      "Free tier: 5 of 5 document generations remaining.",
    );
  });

  it("renders the exhausted-state copy when the quota is gone", () => {
    render(
      <AiSettingsPanel
        initialStatus={{
          ...BASE_STATUS,
          documents: {
            ...BASE_STATUS.documents,
            freeRemaining: 0,
            freeTierState: "exhausted",
          },
        }}
      />,
    );

    expect(screen.getByTestId("free-tier-exhausted")).toHaveTextContent(
      "Free tier exhausted",
    );
  });

  it("renders the unconfigured copy when the operator has no free key", () => {
    render(
      <AiSettingsPanel
        initialStatus={{
          ...BASE_STATUS,
          documents: {
            ...BASE_STATUS.documents,
            freeRemaining: 0,
            freeLimit: 0,
            freeTierState: "unconfigured",
          },
        }}
      />,
    );

    expect(screen.getByTestId("free-tier-unconfigured")).toHaveTextContent(
      "not configured on this deployment",
    );
  });
});

describe("AiSettingsPanel — credential list", () => {
  const CRED_OPENAI = {
    providerId: "openai",
    label: "Work",
    maskedPreview: "sk-…4f2a",
    validatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    lastUsedAt: null,
  };

  it("renders the masked preview and never the plaintext key", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () => ok([CRED_OPENAI])),
    );

    render(
      <AiSettingsPanel
        initialStatus={{ ...BASE_STATUS, credentials: [CRED_OPENAI] }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("ai-credential-list")).toBeInTheDocument(),
    );
    expect(screen.getByText("sk-…4f2a")).toBeInTheDocument();
    // The DOM never contains a plaintext key shape like `sk-…secret`.
    expect(screen.queryByText(/sk-[A-Za-z0-9]{8,}/)).not.toBeInTheDocument();
  });

  it("hides the add-key affordance when byokAvailable is false", () => {
    render(
      <AiSettingsPanel
        initialStatus={{
          ...BASE_STATUS,
          byokAvailable: false,
          credentials: [CRED_OPENAI],
        }}
      />,
    );

    expect(screen.queryByTestId("ai-add-key")).not.toBeInTheDocument();
    // The banner is shown so the user knows why.
    expect(screen.getByTestId("ai-refusal-banner")).toBeInTheDocument();
  });

  it("shows the empty-credentials hint when no keys are saved", () => {
    render(<AiSettingsPanel initialStatus={BASE_STATUS} />);

    expect(
      screen.getByText(/No API keys saved\. Add one to choose/),
    ).toBeInTheDocument();
  });
});

describe("AiSettingsPanel — pickers", () => {
  const CRED_OPENAI = {
    providerId: "openai",
    label: null,
    maskedPreview: "sk-…4f2a",
    validatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    lastUsedAt: null,
  };

  it("only lists providers the user has a credential for", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () => ok([CRED_OPENAI])),
    );

    const user = userEvent.setup();
    render(
      <AiSettingsPanel
        initialStatus={{ ...BASE_STATUS, credentials: [CRED_OPENAI] }}
      />,
    );

    const trigger = await screen.findByTestId("chat-provider-select");
    await user.click(trigger);

    const listbox = await screen.findByRole("listbox", {
      name: /Provider/i,
    });
    const labels = Array.from(listbox.querySelectorAll("li")).map(
      (li) => li.textContent,
    );
    // OpenAI is in the registry; Groq, DeepSeek, OpenRouter are not because
    // the user has no credential for them.
    expect(labels).toContain("OpenAI");
    expect(labels).not.toContain("Groq");
    expect(labels).not.toContain("DeepSeek");
  });

  it("filters out models lacking the required capability for a feature", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () => ok([CRED_OPENAI])),
    );

    const user = userEvent.setup();
    render(
      <AiSettingsPanel
        initialStatus={{ ...BASE_STATUS, credentials: [CRED_OPENAI] }}
      />,
    );

    const trigger = await screen.findByTestId("chat-model-select");
    await user.click(trigger);

    const listbox = await screen.findByRole("listbox", { name: /Model/i });
    const labels = Array.from(listbox.querySelectorAll("li")).map(
      (li) => li.textContent,
    );
    // gpt-5-nano has tools; it is offered.
    expect(labels).toContain("GPT-5 Nano");
  });

  it("sends the picked preference to PUT /api/ai/preferences on change", async () => {
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () => ok([CRED_OPENAI])),
      http.put(`${BACKEND_URL}/api/ai/preferences`, async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return ok({
          feature: captured.feature,
          providerId: captured.providerId,
          modelId: captured.modelId,
        });
      }),
    );

    const user = userEvent.setup();
    render(
      <AiSettingsPanel
        initialStatus={{ ...BASE_STATUS, credentials: [CRED_OPENAI] }}
      />,
    );

    const trigger = await screen.findByTestId("chat-model-select");
    await user.click(trigger);

    const gptOption = await screen.findByRole("option", {
      name: "GPT-5 Nano",
    });
    await user.click(gptOption);

    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured).toMatchObject({
      feature: "chat",
      providerId: "openai",
      modelId: "gpt-5-nano",
    });
  });

  it("renders a server error inline when the picker save fails", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () => ok([CRED_OPENAI])),
      http.put(`${BACKEND_URL}/api/ai/preferences`, () =>
        HttpResponse.json(
          { success: false, message: "That model is not available." },
          { status: 422 },
        ),
      ),
    );

    const user = userEvent.setup();
    render(
      <AiSettingsPanel
        initialStatus={{ ...BASE_STATUS, credentials: [CRED_OPENAI] }}
      />,
    );

    const trigger = await screen.findByTestId("chat-model-select");
    await user.click(trigger);

    const gptOption = await screen.findByRole("option", {
      name: "GPT-5 Nano",
    });
    await user.click(gptOption);

    await waitFor(() =>
      expect(screen.getByTestId("chat-picker-error")).toHaveTextContent(
        "That model is not available.",
      ),
    );
  });
});

describe("AiSettingsPanel — add key flow", () => {
  it("opens the dialog, saves, and shows the new credential in the list", async () => {
    let saved = false;
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () =>
        ok(
          saved
            ? [
                {
                  providerId: "openai",
                  label: null,
                  maskedPreview: "sk-…4f2a",
                  validatedAt: null,
                  createdAt: new Date().toISOString(),
                  lastUsedAt: null,
                },
              ]
            : [],
        ),
      ),
      http.post(`${BACKEND_URL}/api/ai/credentials`, () => {
        saved = true;
        return ok(
          {
            providerId: "openai",
            label: null,
            maskedPreview: "sk-…4f2a",
            validatedAt: null,
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
          },
          "Credential saved",
        );
      }),
    );

    const user = userEvent.setup();
    render(<AiSettingsPanel initialStatus={BASE_STATUS} />);

    await user.click(screen.getByTestId("ai-add-key"));

    expect(screen.getByLabelText("add-api-key-form")).toBeInTheDocument();

    await user.type(
      screen.getByTestId("api-key-input"),
      "sk-secret-key-1234567890",
    );
    await user.click(screen.getByTestId("api-key-save"));

    await waitFor(() =>
      expect(
        screen.getByTestId("ai-credential-row-openai"),
      ).toBeInTheDocument(),
    );
  });

  it("removes a credential and refreshes the list", async () => {
    const CRED = {
      providerId: "openai",
      label: "Work",
      maskedPreview: "sk-…4f2a",
      validatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      lastUsedAt: null,
    };
    let current = [CRED];
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () => ok(current)),
      http.delete(
        `${BACKEND_URL}/api/ai/credentials/:providerId`,
        ({ params }) => {
          expect(params.providerId).toBe("openai");
          current = [];
          return ok({ clearedPreferences: 0 }, "Credential removed");
        },
      ),
    );

    const user = userEvent.setup();
    render(
      <AiSettingsPanel
        initialStatus={{ ...BASE_STATUS, credentials: [CRED] }}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("ai-credential-row-openai"),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId("ai-remove-credential-openai"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("ai-credential-row-openai"),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows a remove error when the API rejects the deletion", async () => {
    const CRED = {
      providerId: "openai",
      label: "Work",
      maskedPreview: "sk-…4f2a",
      validatedAt: null,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () => ok([CRED])),
      http.delete(`${BACKEND_URL}/api/ai/credentials/:providerId`, () =>
        HttpResponse.json(
          { success: false, message: "Could not remove." },
          { status: 500 },
        ),
      ),
    );

    const user = userEvent.setup();
    render(
      <AiSettingsPanel
        initialStatus={{ ...BASE_STATUS, credentials: [CRED] }}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("ai-credential-row-openai"),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId("ai-remove-credential-openai"));

    await waitFor(() =>
      expect(screen.getByText("Could not remove.")).toBeInTheDocument(),
    );
  });

  it("switches the picker to a different provider on change", async () => {
    const CRED_OPENAI = {
      providerId: "openai",
      label: null,
      maskedPreview: "sk-…4f2a",
      validatedAt: null,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    const CRED_DEEPSEEK = {
      ...CRED_OPENAI,
      providerId: "deepseek",
      maskedPreview: "sk-…abcd",
    };

    let captured: Record<string, unknown> | null = null;
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () =>
        ok([CRED_OPENAI, CRED_DEEPSEEK]),
      ),
      http.put(`${BACKEND_URL}/api/ai/preferences`, async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return ok({
          feature: captured.feature,
          providerId: captured.providerId,
          modelId: captured.modelId,
        });
      }),
    );

    const user = userEvent.setup();
    render(
      <AiSettingsPanel
        initialStatus={{
          ...BASE_STATUS,
          credentials: [CRED_OPENAI, CRED_DEEPSEEK],
        }}
      />,
    );

    const trigger = await screen.findByTestId("chat-provider-select");
    await user.click(trigger);

    const deepseekOption = await screen.findByRole("option", {
      name: "DeepSeek",
    });
    await user.click(deepseekOption);

    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured).toMatchObject({
      feature: "chat",
      providerId: "deepseek",
      modelId: "deepseek-flash",
    });
  });
});
