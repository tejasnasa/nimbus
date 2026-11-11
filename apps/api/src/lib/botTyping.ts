/**
 * @module api/lib/botTyping
 * @description The "NimbusBot is typing" signal. A workspace room is told
 * `bot:typing { workspaceId, typing: true }` when the first of its pending
 * mentions starts being answered, and `typing: false` when the last one
 * finishes, fails or hands over to document generation.
 *
 * @important Mentions overlap, so the state per workspace is a count, not a
 *            flag: a second mention starting must not clear the indicator when
 *            the first one finishes. The signal flips only on the 0 to 1 and 1
 *            to 0 transitions.
 *
 * @important Every `start` arms a safety timer ({@link BOT_TYPING_TIMEOUT_MS}).
 *            If the work behind it never reports back, the timer ends it, so a
 *            crash cannot leave the room showing a bot that is typing forever.
 *            The timer does not keep the process alive.
 *
 * @important The counts are process-local, like the other in-memory room state.
 *            With several API replicas each counts only the mentions it is
 *            answering, so an indicator can clear a little early; the safety
 *            timer bounds the opposite error.
 */
import type { Server } from "socket.io";

/** The slice of Socket.IO the signal is broadcast through. */
export type BotTypingBroadcaster = Pick<Server, "to">;

/** How long an unfinished mention may keep the indicator on. */
export const BOT_TYPING_TIMEOUT_MS = 60_000;

/** Mentions currently being answered, per workspace. */
const pending = new Map<string, number>();

/** One mention's share of the indicator. */
export type BotTyping = {
  /** Turns the indicator on for this mention. Calling it again does nothing. */
  start: () => void;
  /** Ends this mention's share. Safe to call any number of times. */
  stop: () => void;
};

/**
 * Creates the typing handle for one mention.
 *
 * @param io - Broadcaster for `bot:typing`.
 * @param workspaceId - The workspace the mention was made in.
 * @param timeoutMs - Safety timeout; the default is for production, tests
 *                    shorten it.
 */
export function createBotTyping(
  io: BotTypingBroadcaster,
  workspaceId: string,
  timeoutMs: number = BOT_TYPING_TIMEOUT_MS,
): BotTyping {
  let state: "idle" | "active" | "done" = "idle";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const emit = (typing: boolean) => {
    try {
      io.to(workspaceId).emit("bot:typing", { workspaceId, typing });
    } catch (error) {
      console.error(
        "[bot] typing broadcast failed:",
        error instanceof Error ? error.name : "unknown error",
      );
    }
  };

  const stop = () => {
    if (state !== "active") return;
    state = "done";
    if (timer) clearTimeout(timer);
    const left = (pending.get(workspaceId) ?? 1) - 1;
    if (left > 0) {
      pending.set(workspaceId, left);
      return;
    }
    pending.delete(workspaceId);
    emit(false);
  };

  const start = () => {
    if (state !== "idle") return;
    state = "active";
    const count = (pending.get(workspaceId) ?? 0) + 1;
    pending.set(workspaceId, count);
    if (count === 1) emit(true);
    timer = setTimeout(stop, timeoutMs);
    timer.unref?.();
  };

  return { start, stop };
}
