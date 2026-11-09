/**
 * @module web/tests/components/WorkspaceAiPanel
 * @description The workspace settings AI tab for each role. An admin manages
 * keys (with the model kinds each was verified for), models, the assistant
 * switches and the spend cap; a member gets a read-only summary and no
 * controls. The role comes from the server's `canManage`, so every case here
 * feeds the panel a status rather than a role.
 */
import "./testUtils";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiWorkspaceStatusDTO } from "@nimbus/types";
import WorkspaceAiPanel from "../../components/WorkspaceAiPanel";
import type { UseWorkspaceAiStatus } from "../../hooks/useWorkspaceAiStatus";
import { BACKEND_URL, fail, ok } from "../msw/handlers";
import { server } from "../msw/server";
import {
  aiSettings,
  aiStatus,
  aiStatusChatOff,
  credential,
  featureOff,
} from "../msw/aiFixtures";

const WS = "ws-1";
const route = (suffix: string) => `${BACKEND_URL}/api/ai/workspaces/${WS}${suffix}`;

const ready = (status: AiWorkspaceStatusDTO): UseWorkspaceAiStatus => ({
  state: { kind: "ready", status },
  refresh: vi.fn(async () => {}),
});

beforeEach(() => {
  server.resetHandlers();
});

describe("WorkspaceAiPanel: states", () => {
  it("shows a loading line while the status loads", () => {
    render(
      <WorkspaceAiPanel
        workspaceId={WS}
        status={{ state: { kind: "loading" }, refresh: vi.fn(async () => {}) }}
      />,
    );
    expect(screen.getByTestId("ai-loading")).toBeInTheDocument();
  });

  it("shows the error message when the status failed", () => {
    render(
      <WorkspaceAiPanel
        workspaceId={WS}
        status={{
          state: { kind: "error", message: "Workspace not found" },
          refresh: vi.fn(async () => {}),
        }}
      />,
    );
    expect(screen.getByTestId("ai-error")).toHaveTextContent("Workspace not found");
  });
});

describe("WorkspaceAiPanel: member", () => {
  it("shows a read-only summary with no controls and no admin requests", async () => {
    const hits: string[] = [];
    server.use(
      http.get(route("/credentials"), () => {
        hits.push("credentials");
        return ok([]);
      }),
      http.get(route("/usage"), () => {
        hits.push("usage");
        return ok({});
      }),
    );
    const status = aiStatus({
      canManage: false,
      features: {
        chat: featureOff("no-key"),
        canvas: featureOff("spend-cap-reached"),
      },
      voice: { available: false, reason: "assistant-disabled", speaks: false },
    });
    render(<WorkspaceAiPanel workspaceId={WS} status={ready(status)} />);

    expect(screen.getByTestId("ai-member-summary")).toBeInTheDocument();
    expect(screen.getByText(/Keys are managed by workspace admins/)).toBeInTheDocument();
    expect(screen.getByTestId("ai-summary-Chat replies")).toHaveTextContent("Needs a key");
    expect(screen.getByTestId("ai-summary-Canvas diagrams")).toHaveTextContent(
      "Monthly cap reached",
    );
    expect(screen.getByTestId("ai-summary-Markdown documents")).toHaveTextContent(
      "Works here",
    );
    expect(screen.getByTestId("ai-summary-In-call assistant")).toHaveTextContent(
      "Turned off",
    );
    expect(screen.queryByTestId("ai-add-key")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workspace-ai-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-spend-cap-input")).not.toBeInTheDocument();

    await new Promise((r) => setTimeout(r, 30));
    expect(hits).toEqual([]);
  });

  it("states the member's own free allowance", () => {
    render(
      <WorkspaceAiPanel
        workspaceId={WS}
        status={ready(
          aiStatus({
            canManage: false,
            free: { docsRemaining: 3, docsLimit: 5, voiceSecondsRemaining: 120, voiceSecondsLimit: 600 },
          }),
        )}
      />,
    );
    expect(screen.getByText(/3 of 5/)).toBeInTheDocument();
    expect(screen.getByText(/2 of 10 assistant minutes/)).toBeInTheDocument();
  });
});

describe("WorkspaceAiPanel: admin", () => {
  const adminStatus = aiStatus({ canManage: true });

  it("shows the key list with the verified kinds of each key", async () => {
    server.use(
      http.get(route("/credentials"), () =>
        ok([
          credential({ providerId: "openai", verifiedKinds: ["text", "transcription"] }),
          credential({ providerId: "groq", label: "Team Groq", verifiedKinds: ["text"] }),
        ]),
      ),
    );
    render(<WorkspaceAiPanel workspaceId={WS} status={ready(adminStatus)} />);

    const row = await screen.findByTestId("ai-credential-row-openai");
    expect(within(row).getByTestId("ai-kind-openai-text")).toBeInTheDocument();
    expect(within(row).getByTestId("ai-kind-openai-transcription")).toBeInTheDocument();
    expect(within(row).queryByTestId("ai-kind-openai-speech")).not.toBeInTheDocument();
    expect(within(row).getByText("sk-…4f2a")).toBeInTheDocument();
    expect(screen.getByTestId("ai-credential-row-groq")).toHaveTextContent("Team Groq");
  });

  it("says there are no keys when the list is empty", async () => {
    render(<WorkspaceAiPanel workspaceId={WS} status={ready(adminStatus)} />);
    expect(await screen.findByText(/No API keys saved/)).toBeInTheDocument();
  });

  it("lists a picker for every feature", async () => {
    render(<WorkspaceAiPanel workspaceId={WS} status={ready(adminStatus)} />);
    for (const label of [
      "Chat replies",
      "Markdown documents",
      "Canvas diagrams",
      "Reading images",
      "Meeting notes and answers",
      "Transcription",
      "Speech",
    ]) {
      expect(
        await screen.findByRole("heading", { name: label }),
      ).toBeInTheDocument();
    }
  });

  it("adds a key through the dialog and shows the kinds that could not be verified", async () => {
    let stored = false;
    server.use(
      http.get(route("/credentials"), () =>
        ok(stored ? [credential({ verifiedKinds: ["text"] })] : []),
      ),
      http.post(route("/credentials"), () => {
        stored = true;
        return ok(
          { ...credential(), warnings: ["Speech models could not be verified: nope"] },
          "Credential saved.",
        );
      }),
    );
    const status = ready(adminStatus);
    render(<WorkspaceAiPanel workspaceId={WS} status={status} />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("ai-add-key"));
    const form = within(await screen.findByLabelText("add-api-key-form"));
    await user.type(form.getByLabelText(/API key/i), "sk-test-fake-key-1234");
    await user.click(form.getByRole("button", { name: /^save/i }));

    const warnings = await screen.findByTestId("ai-save-warnings");
    expect(warnings).toHaveTextContent("Speech models could not be verified: nope");
    expect(await screen.findByTestId("ai-credential-row-openai")).toBeInTheDocument();
    expect(status.refresh).toHaveBeenCalled();
  });

  it("removes a key and refreshes the status", async () => {
    let removed = false;
    server.use(
      http.get(route("/credentials"), () => ok(removed ? [] : [credential()])),
      http.delete(route("/credentials/openai"), () => {
        removed = true;
        return ok({ clearedPreferences: 1 });
      }),
    );
    const status = ready(adminStatus);
    render(<WorkspaceAiPanel workspaceId={WS} status={status} />);

    await userEvent.setup().click(await screen.findByTestId("ai-remove-credential-openai"));

    await waitFor(() =>
      expect(screen.queryByTestId("ai-credential-row-openai")).not.toBeInTheDocument(),
    );
    expect(status.refresh).toHaveBeenCalled();
  });

  it("shows the server's message when a removal fails", async () => {
    server.use(
      http.get(route("/credentials"), () => ok([credential()])),
      http.delete(route("/credentials/openai"), () => fail(500, "Could not remove it")),
    );
    render(<WorkspaceAiPanel workspaceId={WS} status={ready(adminStatus)} />);

    await userEvent.setup().click(await screen.findByTestId("ai-remove-credential-openai"));

    expect(await screen.findByText("Could not remove it")).toBeInTheDocument();
    expect(screen.getByTestId("ai-credential-row-openai")).toBeInTheDocument();
  });

  it("opens the dialog on the provider being replaced", async () => {
    server.use(http.get(route("/credentials"), () => ok([credential({ providerId: "groq" })])));
    render(<WorkspaceAiPanel workspaceId={WS} status={ready(adminStatus)} />);

    await userEvent.setup().click(await screen.findByTestId("ai-replace-credential-groq"));

    expect(await screen.findByLabelText("add-api-key-form")).toBeInTheDocument();
  });
});

describe("WorkspaceAiPanel: assistant switches and spend cap", () => {
  const adminStatus = aiStatus({ canManage: true });

  it("saves the assistant switches", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(route("/settings"), () => ok(aiSettings())),
      http.put(route("/settings"), async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        return ok(aiSettings({ assistantSpeaks: false }));
      }),
    );
    render(<WorkspaceAiPanel workspaceId={WS} status={ready(adminStatus)} />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("ai-assistant-speaks"));

    await waitFor(() => expect(bodies).toEqual([{ assistantSpeaks: false }]));
    await waitFor(() =>
      expect(screen.getByTestId("ai-assistant-speaks")).not.toBeChecked(),
    );
  });

  it("locks the speaking switch while the assistant is off", async () => {
    server.use(
      http.get(route("/settings"), () => ok(aiSettings({ assistantEnabled: false }))),
    );
    render(<WorkspaceAiPanel workspaceId={WS} status={ready(adminStatus)} />);
    expect(await screen.findByTestId("ai-assistant-speaks")).toBeDisabled();
  });

  it("shows month-to-date spend beside the cap", async () => {
    server.use(
      http.get(route("/settings"), () =>
        ok(aiSettings({ monthlySpendCapUsd: 25, monthToDateCostUsd: 1.5 })),
      ),
    );
    render(<WorkspaceAiPanel workspaceId={WS} status={ready(adminStatus)} />);

    expect(await screen.findByTestId("ai-month-to-date")).toHaveTextContent("$1.5000");
    expect(screen.getByTestId("ai-spend-cap-input")).toHaveValue(25);
  });

  it("saves a cap rounded to cents, and clears it when blank", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(route("/settings"), () => ok(aiSettings())),
      http.put(route("/settings"), async ({ request }) => {
        const body = (await request.json()) as { monthlySpendCapUsd: number | null };
        bodies.push(body);
        return ok(aiSettings({ monthlySpendCapUsd: body.monthlySpendCapUsd }));
      }),
    );
    render(<WorkspaceAiPanel workspaceId={WS} status={ready(adminStatus)} />);
    const user = userEvent.setup();

    const input = await screen.findByTestId("ai-spend-cap-input");
    expect(screen.getByTestId("ai-spend-cap-save")).toBeDisabled();
    await user.type(input, "12.345");
    await user.click(screen.getByTestId("ai-spend-cap-save"));
    await waitFor(() => expect(bodies).toEqual([{ monthlySpendCapUsd: 12.35 }]));

    await user.clear(screen.getByTestId("ai-spend-cap-input"));
    await user.click(screen.getByTestId("ai-spend-cap-save"));
    await waitFor(() => expect(bodies[1]).toEqual({ monthlySpendCapUsd: null }));
  });

  it("refuses a zero or negative cap on the client, without a request", async () => {
    let puts = 0;
    server.use(
      http.get(route("/settings"), () => ok(aiSettings())),
      http.put(route("/settings"), () => {
        puts += 1;
        return ok(aiSettings());
      }),
    );
    render(<WorkspaceAiPanel workspaceId={WS} status={ready(adminStatus)} />);
    const user = userEvent.setup();

    await user.type(await screen.findByTestId("ai-spend-cap-input"), "0");
    await user.click(screen.getByTestId("ai-spend-cap-save"));

    expect(await screen.findByText(/greater than zero/)).toBeInTheDocument();
    expect(puts).toBe(0);
  });

  it("shows the server's message when a cap save is rejected", async () => {
    server.use(
      http.get(route("/settings"), () => ok(aiSettings())),
      http.put(route("/settings"), () => fail(403, "You do not have permission")),
    );
    render(<WorkspaceAiPanel workspaceId={WS} status={ready(adminStatus)} />);
    const user = userEvent.setup();

    await user.type(await screen.findByTestId("ai-spend-cap-input"), "5");
    await user.click(screen.getByTestId("ai-spend-cap-save"));

    expect(await screen.findByText("You do not have permission")).toBeInTheDocument();
  });
});

describe("WorkspaceAiPanel: status reasons", () => {
  it("is not driven by a chat refusal for a member", () => {
    render(
      <WorkspaceAiPanel
        workspaceId={WS}
        status={ready(aiStatusChatOff("no-capable-model", false))}
      />,
    );
    expect(screen.getByTestId("ai-summary-Chat replies")).toHaveTextContent(
      "No capable model",
    );
  });
});
