/**
 * @module api/socket/chat
 * @description Workspace chat + presence + NimbusBot pipeline.
 *
 * Handles `workspace:join/leave` (membership check → room join → Redis
 * presence → `presence:*` broadcasts), `message:send` (persist → `message:new`
 * fan-out), `@nimbusbot` mentions (resolve → decide → claim → announce →
 * generate → refund, with `ai:refused` for the targeted no-go), ephemeral
 * `typing:*` relays, and `disconnecting` presence cleanup.
 *
 * @important Assumes handshake auth (`socket.data.user`). Bot generation runs
 *            detached so slow LLM calls never block chat delivery.
 *
 * @important The bot's `chatMessage` ("Sure! I am creating the document…") is
 *            posted ONLY after a successful quota claim, so a quota-exhausted
 *            user never sees a bot promise a document that will not arrive.
 *            The refusal flow posts nothing to chat; the asking socket gets
 *            `ai:refused` directly so the room never sees an announcement for
 *            a generation that never started.
 */
import { prisma } from "@nimbus/db";
import type { BotResult } from "@nimbus/types";
import { Server, Socket } from "socket.io";
import { generateBotResponse } from "../lib/bot";
import { generateCanvasDocument } from "../lib/canvasGeneration";
import { generateMarkdownDocument } from "../lib/markdownGeneration";
import { presenceService } from "../lib/presence";
import { resolveAi, type AiResolution } from "../lib/ai/entitlements";
import {
  claimFreeDocGeneration,
  readQuotaState,
  refundFreeDocGeneration,
} from "../lib/ai/quota";

/**
 * Registers chat/presence/bot handlers for one socket.
 *
 * Disconnects sockets with no authenticated user; every event re-checks
 * workspace membership so revoked members lose access immediately.
 *
 * @param io - Server for room broadcasts.
 * @param socket - Authenticated client socket (`socket.data.user` trusted).
 */
const registerChatHandlers = (io: Server, socket: Socket) => {
  const user = socket.data.user;

  if (!user?.id) {
    socket.disconnect();
    return;
  }

  /** Join flow: verify member → join room → mark present → notify room + replay roster. */
  socket.on("workspace:join", async (workspaceId: string) => {
    try {
      const member = await prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: user.id,
            workspaceId,
          },
        },
      });

      if (!member) {
        // Told, not just logged: the client would otherwise sit connected but
        // non-functional with no way to tell "denied" from "still connecting".
        return socket.emit("workspace:error", "Not a member of this workspace");
      }

      socket.join(workspaceId);

      await presenceService.userJoined(workspaceId, user.id);

      io.to(workspaceId).emit("presence:joined", {
        userId: user.id,
        name: user.name,
      });

      const onlineUserIds = await presenceService.getOnlineUsers(workspaceId);

      socket.emit("presence:online_users", onlineUserIds);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("workspace:leave", async (workspaceId: string) => {
    try {
      const member = await prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: user.id,
            workspaceId,
          },
        },
      });

      if (!member) return;

      socket.leave(workspaceId);

      await presenceService.userLeft(workspaceId, user.id);

      io.to(workspaceId).emit("presence:left", {
        userId: user.id,
      });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on(
    "message:send",
    async (data: { workspaceId: string; content: string }) => {
      try {
        const member = await prisma.workspaceMember.findUnique({
          where: {
            userId_workspaceId: {
              userId: user.id,
              workspaceId: data.workspaceId,
            },
          },
        });

        if (!member) return;

        const message = await prisma.message.create({
          data: {
            content: data.content,
            userId: user.id,
            workspaceId: data.workspaceId,
          },
        });

        io.to(data.workspaceId).emit("message:new", {
          ...message,
          name: user.name,
          image: user.image,
        });

        // Case-insensitive mention check; bot work runs detached so the sender's
        // ack path never waits on Groq/OpenAI latency. Errors are caught and logged.
        if (data.content.toLowerCase().includes("@nimbusbot")) {
          (async () => {
            await handleBotMention({
              io,
              socket,
              userId: user.id,
              workspaceId: data.workspaceId,
              userName: user.name,
              userImage: user.image,
            });
          })().catch((err) => console.error("Bot Reply Error:", err));
        }
      } catch (err) {
        console.error(err);
      }
    },
  );

  // Typing relays are ephemeral (never persisted) and exclude the sender via `socket.to`.
  socket.on("typing:start", (workspaceId: string) => {
    socket.to(workspaceId).emit("typing:start", {
      userId: user.id,
      name: user.name,
    });
  });

  socket.on("typing:stop", (workspaceId: string) => {
    socket.to(workspaceId).emit("typing:stop", {
      userId: user.id,
      name: user.name,
    });
  });

  // `disconnecting` (not `disconnect`): rooms are still intact here, so every
  // joined workspace can be left + presence-cleared before the socket dies.
  socket.on("disconnecting", async () => {
    try {
      await Promise.all(
        [...socket.rooms]
          .filter((room) => room !== socket.id)
          .map((workspaceId) =>
            presenceService.userLeft(workspaceId, user.id).then(() => {
              socket.to(workspaceId).emit("presence:left", {
                userId: user.id,
              });
            }),
          ),
      );
    } catch (err) {
      console.error(err);
    }
  });
};

/** Inputs to {@link handleBotMention}. */
type HandleBotMentionInput = {
  readonly io: Server;
  readonly socket: Socket;
  readonly userId: string;
  readonly workspaceId: string;
  readonly userName: string | null | undefined;
  readonly userImage: string | null | undefined;
};

/**
 * Drives the bot's reply to a `@nimbusbot` mention.
 *
 * The flow:
 *   1. Resolve chat (BYOK or free).
 *   2. Resolve documents separately so quota exhaustion does not disable chat.
 *   3. Generate — with `allowDocument` set from step 2.
 *   4. If the bot chose to create a document, atomically claim a free-tier slot
 *      BEFORE posting the announcement. A failed claim emits `ai:refused` and
 *      posts nothing.
 *   5. Generate the document, refund the claim on provider failure.
 *
 * @important Never throws. Provider-side failures degrade to a `doc:ai:error`
 *            room-wide event with the claim refunded; entitlement refusals
 *            emit `ai:refused` to the asking socket only.
 */
async function handleBotMention(input: HandleBotMentionInput): Promise<void> {
  const { io, socket, userId, workspaceId } = input;

  // 1. Resolve chat. A failure here means the user has no chat path at all
  //    (no key, no operator key, encryption unconfigured).
  const chatResolution = await resolveAi(userId, "chat");
  if (!chatResolution.ok) {
    return emitRefusal(socket, "chat", chatResolution);
  }

  // 2. Resolve documents. A failure here means the user has chat but not
  //    documents — quota exhausted, no capable model, or no encryption key.
  const documentResolution = await resolveDocumentForUser(userId);
  const allowDocument = documentResolution.kind === "available";

  // 3. Generate the bot's reply with the chosen chat handle and the
  //    `allowDocument` flag, so the tool is omitted when no path exists.
  const botResult = await generateBotResponse({
    workspaceId,
    handle: chatResolution.handle,
    allowDocument,
  });

  if (botResult.kind === "refused") {
    return emitRefusalFromBot(socket, botResult);
  }

  // 4. Claim → announce. For `create_document` results we must claim BEFORE
  //    posting the "creating the document" message, otherwise the
  //    announcement is a lie when the quota is gone.
  let claimed = false;
  if (botResult.kind === "create_document") {
    if (documentResolution.kind === "refused") {
      // Defence in depth — `allowDocument: false` removed the tool, so the
      // bot should not have called it. If it did, refuse rather than
      // generate.
      return emitRefusal(socket, "chat", {
        ok: false,
        reason: documentResolution.reason,
        message: documentResolution.message,
        cta: documentResolution.cta,
      });
    }
    // Claim ONLY when the operator's free tier is paying. A user generating
    // on their own key has already paid for it; charging them the operator's
    // allowance both misreports their entitlement and, once the allowance is
    // spent, refuses a document they are entitled to — surfacing as "add an
    // API key" to a user who has one.
    if (documentResolution.source === "free") {
      const claim = await claimFreeDocGeneration(userId);
      if (!claim.granted) {
        return emitRefusal(socket, "chat", {
          ok: false,
          reason: "free-tier-exhausted",
          message: FREE_TIER_EXHAUSTED_MESSAGE,
          cta: "add-key",
        });
      }
      claimed = true;
    }
  }

  // Post the bot message — for a plain reply or the document announcement.
  const botMessage = await prisma.message.create({
    data: {
      content:
        botResult.kind === "reply" ? botResult.content : botResult.chatMessage,
      userId: process.env.BOT_USERID!,
      workspaceId,
    },
    include: { user: true },
  });

  io.to(workspaceId).emit("message:new", {
    ...botMessage,
    name: botMessage.user.name,
    image: botMessage.user.image,
  });

  if (botResult.kind === "create_document") {
    io.to(workspaceId).emit("doc:ai:start", {
      type: botResult.type,
      label: botResult.label,
    });

    try {
      if (botResult.type === "MARKDOWN") {
        // Re-resolve markdown specifically — the chat resolution may have
        // used a different provider/model than the user's saved markdown
        // preference.
        const mdResolution = await resolveAi(userId, "markdown");
        if (!mdResolution.ok) {
          throw new Error(mdResolution.message);
        }
        const { fullContent } = await generateMarkdownDocument({
          prompt: botResult.prompt,
          label: botResult.label,
          onToken: () => {},
          onThinking: (token) => {
            io.to(workspaceId).emit("doc:ai:thinking", { token });
          },
          handle: mdResolution.handle,
        });

        const doc = await prisma.document.create({
          data: {
            title: botResult.label,
            type: "MARKDOWN",
            workspaceId,
            initialContent: fullContent,
          },
        });

        io.to(workspaceId).emit("doc:ai:complete", {
          documentId: doc.id,
          label: doc.title,
          type: doc.type,
        });
      } else {
        const canvasResolution = await resolveAi(userId, "canvas");
        if (!canvasResolution.ok) {
          throw new Error(canvasResolution.message);
        }
        const { canvasData } = await generateCanvasDocument({
          prompt: botResult.prompt,
          label: botResult.label,
          onReasoning: (token) => {
            io.to(workspaceId).emit("doc:ai:thinking", { token });
          },
          onStatus: () => {},
          handle: canvasResolution.handle,
        });

        const doc = await prisma.document.create({
          data: {
            title: botResult.label,
            type: "CANVAS",
            workspaceId,
            canvasData,
          },
        });

        io.to(workspaceId).emit("doc:ai:complete", {
          documentId: doc.id,
          label: doc.title,
          type: doc.type,
          canvasData,
        });
      }

      // Generation succeeded — the claim is now spent.
      claimed = false;
    } catch (err) {
      // Generation failed AFTER a successful claim. Refund so the user does
      // not lose a free generation to a provider-side failure. The refund is
      // bounded — only this call's claim is returned — and the failure path
      // that triggers it is provider-side, so it cannot be farmed.
      console.error("Doc generation error:", err);
      if (claimed) {
        await refundFreeDocGeneration(userId);
        claimed = false;
      }
      io.to(workspaceId).emit("doc:ai:error", {
        message: "Document generation failed. Please try again.",
      });

      try {
        const errorBotMessage = await prisma.message.create({
          data: {
            content: `Sorry, I failed to create the document "${botResult.label}". Please try again.`,
            userId: process.env.BOT_USERID!,
            workspaceId,
          },
          include: { user: true },
        });

        io.to(workspaceId).emit("message:new", {
          ...errorBotMessage,
          name: errorBotMessage.user.name,
          image: errorBotMessage.user.image,
        });
      } catch (dbErr) {
        console.error("Error creating failure bot message:", dbErr);
      }
    }
  }
}

/** The one place the exhausted-quota refusal copy is written. */
const FREE_TIER_EXHAUSTED_MESSAGE =
  "You've used all your free document generations. Add your own API key to keep creating.";

/**
 * Resolves whether the user can create a document right now, and on whose
 * key it will run.
 *
 * Documents are a separate resolution from `chat` because they have a
 * different entitlement: a chat resolution on the operator's free tier must
 * not silently grant document generation.
 *
 * @important `source` is load-bearing and must be carried to the caller. The
 *            quota is a *free-tier* allowance — a user generating on their own
 *            key neither spends it nor can be blocked by it. The caller claims
 *            a slot only when `source === "free"`; dropping this field (or
 *            defaulting it) silently charges BYOK users for the operator's
 *            allowance and refuses them the moment that allowance runs out,
 *            which reads to the user as "add an API key" while they already
 *            have one.
 */
type DocumentResolution =
  | { kind: "available"; source: "byok" | "free" }
  | {
      kind: "refused";
      reason:
        | "no-key"
        | "free-tier-exhausted"
        | "no-operator-key"
        | "no-capable-model";
      message: string;
      cta: "add-key" | "manage-ai" | null;
    };

async function resolveDocumentForUser(
  userId: string,
): Promise<DocumentResolution> {
  const resolution = await resolveAi(userId, "markdown");
  if (!resolution.ok) {
    return {
      kind: "refused",
      reason: resolution.reason,
      message: resolution.message,
      cta: resolution.cta,
    };
  }
  // Only the free tier is metered. We do a cheap read here for UX (so the
  // bot's allowDocument flag is honest about remaining slots) and rely on the
  // atomic claim at generate-time for correctness.
  if (resolution.source === "free") {
    const state = await readQuotaState(userId);
    if (state.exhausted) {
      return {
        kind: "refused",
        reason: "free-tier-exhausted",
        message: FREE_TIER_EXHAUSTED_MESSAGE,
        cta: "add-key",
      };
    }
  }
  return { kind: "available", source: resolution.source };
}

/**
 * Emits `ai:refused` to the asking socket only. Never broadcast — the reason
 * is a personal state and a phantom GENERATING tab would be a worse leak.
 */
function emitRefusal(
  socket: Socket,
  feature: "chat" | "markdown" | "canvas",
  refusal: Extract<AiResolution, { ok: false }>,
) {
  socket.emit("ai:refused", {
    feature,
    reason: refusal.reason,
    message: refusal.message,
    cta: refusal.cta,
  });
}

/** Same shape as `emitRefusal`, sourced from a `BotResult`. */
function emitRefusalFromBot(
  socket: Socket,
  botResult: Extract<BotResult, { kind: "refused" }>,
) {
  socket.emit("ai:refused", {
    feature: botResult.feature,
    reason: botResult.reason,
    message: botResult.message,
    cta: botResult.cta,
  });
}

export default registerChatHandlers;
