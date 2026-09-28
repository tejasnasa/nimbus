/**
 * @module api/__tests__/unit/bot
 * @description The NimbusBot decision pipeline. The LLM client is mocked (never
 * call a real model), but history is assembled from a real database so the
 * 20-message window and role mapping are exercised against actual rows.
 *
 * `bot.ts` promises never to throw: failures degrade to a plain reply so the
 * chat handler stays simple. That contract is asserted here.
 *
 * The mock is the per-call `client.responses.create` — the production code
 * path is now through a per-request `AiClientHandle`, not a module-level
 * singleton, so the seam is the handle the chat handler constructs and the
 * test constructs with throwaway data.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

import { AI_PROVIDERS, modelById, type AiProviderSpec } from "@nimbus/types";
import { generateBotResponse } from "../../lib/bot";
import type { AiClientHandle } from "../../lib/ai/clientFactory";
import {
  closeTestResources,
  createMessage,
  createUser,
  createWorkspace,
  resetDatabase,
} from "@testhelpers";

afterAll(closeTestResources);

/** A plain-text reply response, i.e. no tool call. */
const replyWith = (text: string) => ({
  output: [{ type: "message" }],
  output_text: text,
});

/** A response that fires the `create_document` tool. */
const toolCallWith = (args: unknown) => ({
  output: [
    {
      type: "function_call",
      name: "create_document",
      arguments: typeof args === "string" ? args : JSON.stringify(args),
    },
  ],
  output_text: "",
});

/**
 * A test-only handle whose SDK client is the mocked `createMock`. Production
 * calls go through `createAiClient`; tests inject a fake to avoid touching
 * the SDK's constructor. The provider/model id on the handle is what the
 * production code reads, so the test asserts on it.
 */
const makeTestHandle = (
  provider: AiProviderSpec = AI_PROVIDERS.deepseek,
  modelId = "deepseek-flash",
): AiClientHandle => {
  const model = modelById(provider, modelId);
  if (!model) throw new Error(`unknown model ${modelId}`);
  return {
    providerId: provider.id,
    modelId: model.id,
    source: "free",
    supportsReasoning: model.capabilities.includes("reasoning"),
    client: {
      responses: { create: createMock },
    } as unknown as AiClientHandle["client"],
  };
};

const historySent = () =>
  createMock.mock.calls.at(-1)?.[0]?.input as Array<{
    role: string;
    content: string;
  }>;

describe("lib/bot", () => {
  let workspaceId: string;
  let authorName: string;

  beforeEach(async () => {
    await resetDatabase();
    createMock.mockReset();

    const author = await createUser("Ada Lovelace");
    authorName = author.name;
    workspaceId = (await createWorkspace(author.id)).id;
  });

  describe("history assembly", () => {
    beforeEach(() => {
      createMock.mockResolvedValue(replyWith("ok"));
    });

    it("maps the bot's own messages to the assistant role", async () => {
      await createMessage(workspaceId, process.env.BOT_USERID!, "I am the bot");
      await createMessage(
        workspaceId,
        (await createUser("Grace Hopper")).id,
        "hi bot",
      );

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      const history = historySent();
      expect(history[0]).toMatchObject({
        role: "assistant",
        content: "I am the bot",
      });
    });

    it("prefixes other users' messages with their display name", async () => {
      await createMessage(
        workspaceId,
        (await createUser("Grace Hopper")).id,
        "hi bot",
      );

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(historySent()[0]).toMatchObject({
        role: "user",
        content: "Grace Hopper: hi bot",
      });
    });

    it("orders history oldest-first, as the model expects", async () => {
      const grace = await createUser("Grace Hopper");
      await createMessage(workspaceId, grace.id, "first");
      await createMessage(workspaceId, grace.id, "second");
      await createMessage(workspaceId, grace.id, "third");

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(historySent().map((m) => m.content)).toEqual([
        "Grace Hopper: first",
        "Grace Hopper: second",
        "Grace Hopper: third",
      ]);
    });

    it("caps history at the 20 most recent messages", async () => {
      const grace = await createUser("Grace Hopper");
      for (let i = 1; i <= 25; i += 1) {
        await createMessage(workspaceId, grace.id, `message-${i}`);
      }

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      const history = historySent();
      expect(history).toHaveLength(20);
      expect(history.at(-1)?.content).toBe("Grace Hopper: message-25");
      expect(history[0]?.content).toBe("Grace Hopper: message-6");
    });

    it("does not leak another workspace's messages", async () => {
      const other = await createWorkspace((await createUser("Other")).id);
      await createMessage(
        other.id,
        (await createUser("Outsider")).id,
        "not mine",
      );
      await createMessage(
        workspaceId,
        (await createUser("Grace Hopper")).id,
        "mine",
      );

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      const contents = historySent().map((m) => m.content);
      expect(contents).toEqual(["Grace Hopper: mine"]);
    });

    it("passes the handle's model id, not an env var", async () => {
      await createMessage(
        workspaceId,
        (await createUser("Grace Hopper")).id,
        "hi",
      );

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(AI_PROVIDERS.deepseek, "deepseek-flash"),
        allowDocument: true,
      });

      expect(createMock.mock.calls.at(-1)?.[0]?.model).toBe("deepseek-flash");
    });
  });

  describe("decisions", () => {
    it("returns a plain reply when no tool call is made", async () => {
      createMock.mockResolvedValue(replyWith("Nothing to build"));

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toEqual({ kind: "reply", content: "Nothing to build" });
    });

    it("falls back to an apology when the model returns no text", async () => {
      createMock.mockResolvedValue({ output: [], output_text: "" });

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toMatchObject({ kind: "reply" });
      if (result.kind === "reply")
        expect(result.content).toMatch(/couldn't process/i);
    });

    it("returns create_document when the tool fires", async () => {
      createMock.mockResolvedValue(
        toolCallWith({
          type: "CANVAS",
          label: "Auth Flow",
          prompt: "draw the auth flow",
        }),
      );

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toMatchObject({
        kind: "create_document",
        type: "CANVAS",
        label: "Auth Flow",
        prompt: "draw the auth flow",
      });
    });

    it("defaults an unrecognised document type to MARKDOWN", async () => {
      createMock.mockResolvedValue(
        toolCallWith({
          type: "SPREADSHEET",
          label: "Sheet",
          prompt: "make a sheet",
        }),
      );

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toMatchObject({
        kind: "create_document",
        type: "MARKDOWN",
      });
    });

    it("substitutes placeholders for a tool call with missing fields", async () => {
      createMock.mockResolvedValue(toolCallWith({ type: "MARKDOWN" }));

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toMatchObject({
        kind: "create_document",
        label: "Untitled Document",
        prompt: "",
      });
    });

    it("degrades to a reply when the tool arguments are unparseable JSON", async () => {
      createMock.mockResolvedValue(toolCallWith('{"type": "CANVAS", '));

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result.kind).toBe("reply");
    });

    it("ignores a tool call it does not recognise", async () => {
      createMock.mockResolvedValue({
        output: [
          { type: "function_call", name: "delete_everything", arguments: "{}" },
        ],
        output_text: "not doing that",
      });

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toEqual({ kind: "reply", content: "not doing that" });
    });
  });

  describe("allowDocument", () => {
    /**
     * The Phase 4 fix for the "bot promises a document that never arrives"
     * bug: when `allowDocument` is false, the `create_document` tool is
     * omitted entirely and the instructions gain one line. The model still
     * has the chat capability — only the document path is removed.
     */
    it("omits the create_document tool when allowDocument is false", async () => {
      createMock.mockResolvedValue(replyWith("I can chat but not make docs"));

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: false,
      });

      const request = createMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      expect(request.tools).toEqual([]);
    });

    it("tells the model that document creation is unavailable", async () => {
      createMock.mockResolvedValue(replyWith("text answer"));

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: false,
      });

      const request = createMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      expect(String(request.instructions)).toMatch(
        /document creation is unavailable/i,
      );
    });

    it("offers the create_document tool when allowDocument is true", async () => {
      createMock.mockResolvedValue(replyWith("ok"));

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      const request = createMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      const tools = request.tools as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe("create_document");
    });

    /**
     * Phase 0 finding F4: OpenAI rejects `strict: true` without
     * `additionalProperties: false`. The fix injects it here so all four
     * providers see the same shape — DeepSeek and Groq accept it as-is,
     * OpenAI requires it. The picker tests rely on the fix not regressing
     * for any BYOK user who picks OpenAI.
     */
    it("injects additionalProperties: false into the tool schema", async () => {
      createMock.mockResolvedValue(replyWith("ok"));

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      const request = createMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      const tools = request.tools as Array<{
        parameters: { additionalProperties?: unknown };
      }>;
      expect(tools[0]?.parameters.additionalProperties).toBe(false);
    });
  });

  describe("client construction (who paid)", () => {
    /**
     * The Phase 4 "who paid" headline assertion: a stage must NOT silently
     * revert to the operator's key. We pin the test on the handle's
     * `providerId` and `modelId` rather than on request-body fields, because
     * the failure mode this feature exists to prevent is a request that
     * carries one provider id and is billed to another.
     */
    it("uses the BYOK handle's provider and model — not env vars", async () => {
      createMock.mockResolvedValue(replyWith("ok"));

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(AI_PROVIDERS.openai, "gpt-5-nano"),
        allowDocument: true,
      });

      const request = createMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      expect(request.model).toBe("gpt-5-nano");
    });
  });

  describe("failure handling", () => {
    it("never throws — an LLM failure becomes a reply", async () => {
      createMock.mockRejectedValue(new Error("groq is down"));

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toMatchObject({ kind: "reply" });
      if (result.kind === "reply")
        expect(result.content).toMatch(/something went wrong/i);
    });

    it("never throws — even when the failure is not an Error", async () => {
      createMock.mockRejectedValue("a plain string failure");

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toMatchObject({ kind: "reply" });
    });
  });

  describe("BOT_USERID handling", () => {
    /**
     * Pins CURRENT behaviour: the role map keys off `BOT_USERID`. With it unset,
     * no row matches, so the bot's own history is relabelled as user input and
     * the model loses the distinction between its replies and the user's.
     */
    it("treats bot-authored messages as user input when BOT_USERID is unset", async () => {
      const botId = process.env.BOT_USERID!;
      // Authored by the real bot user row, so only the env var can classify it.
      await createMessage(workspaceId, botId, "bot line");

      const original = process.env.BOT_USERID;
      delete process.env.BOT_USERID;

      try {
        createMock.mockResolvedValue(replyWith("ok"));

        await generateBotResponse({
          workspaceId,
          handle: makeTestHandle(),
          allowDocument: true,
        });

        const entry = historySent()[0];
        expect(entry).toMatchObject({ role: "user" });
        expect(entry?.content).toContain("bot line");
      } finally {
        process.env.BOT_USERID = original;
      }
    });
  });
});
