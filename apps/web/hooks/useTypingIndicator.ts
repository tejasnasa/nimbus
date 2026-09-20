/**
 * @module web/hooks/useTypingIndicator
 * @description Typing-indicator state for the chat composer. Throttles outgoing
 * `typing:start` to one event every ~2s, auto-stops after ~3s of idle, never
 * fires for an empty composer, and stops immediately on send / blur / unmount.
 * Inbound indicators live in a name-keyed map with a ~5s TTL — a peer that
 * crashes mid-keystroke never sends its `typing:stop`, and without the TTL
 * that user would read as permanently typing.
 *
 * @important The server already excludes the sender's own socket from the
 *            typing relay via `socket.to(workspaceId).emit(...)`, but the same
 *            user in a second tab arrives as a *different* socket and would
 *            otherwise render "You are typing" to the user. Self-id is filtered
 *            client-side.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../lib/socket";

/** One currently-typing peer keyed by user id. */
export interface TypingPeer {
  /** Sender's display name (last seen, in case it changes). */
  name: string;
}

/** Shape returned by the hook — consumed by the composer and the indicator. */
export interface UseTypingIndicatorResult {
  /** Active typers, keyed by user id. Self is never included. */
  typing: Record<string, TypingPeer>;
  /** Convenience: names of currently-typing peers. */
  typingNames: string[];
  /** Call from the composer's `onChange`. */
  handleTypingInput: () => void;
  /** Call on send / blur / explicit stop. */
  stopTyping: () => void;
}

/** How long the hook waits before re-emitting `typing:start` while typing. */
const RESEND_INTERVAL_MS = 2_000;
/** Idle window before `typing:stop` is emitted. */
const IDLE_STOP_MS = 3_000;
/**
 * TTL for an inbound typing entry — applied to `typing:start` so a crashed
 * peer expires on its own, independently of any `typing:stop`.
 */
const INBOUND_TTL_MS = 5_000;

/**
 * Tracks outbound + inbound typing for the calling user in one workspace.
 *
 * @param props.wsid - Workspace the composer belongs to. Pass a stable value;
 *                     changing it rebinds the inbound handlers.
 * @param props.currentUserId - The signed-in user; their own typing events
 *                              are ignored on the inbound side.
 * @returns Typers, their names, and the composer callbacks.
 */
export function useTypingIndicator({
  wsid,
  currentUserId,
}: {
  wsid: string;
  currentUserId: string;
}): UseTypingIndicatorResult {
  const [typing, setTyping] = useState<Record<string, TypingPeer>>({});

  // Live timer handles — refs so the socket cleanup can clear every one of them
  // regardless of which render scheduled them.
  const resendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inboundTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  /**
   * Stops the local user's typing indicator and tears down every outbound
   * timer. Idempotent — safe to call from send, blur, unmount, and the
   * idle timer alike.
   */
  const stopTyping = useCallback(() => {
    if (resendTimerRef.current !== null) {
      clearTimeout(resendTimerRef.current);
      resendTimerRef.current = null;
    }
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    socket.emit("typing:stop", wsid);
  }, [wsid]);

  /**
   * Called from the composer's `onChange`. The composer is the source of
   * truth on emptiness — empty content means not typing, regardless of
   * what just landed here.
   */
  const handleTypingInput = useCallback(() => {
    // Schedule the next `typing:start` if one is not already on the way.
    if (resendTimerRef.current === null) {
      socket.emit("typing:start", wsid);
      resendTimerRef.current = setTimeout(() => {
        resendTimerRef.current = null;
      }, RESEND_INTERVAL_MS);
    }

    // Reset the idle timer so a continuous stream of keystrokes keeps
    // the indicator alive without re-emitting `typing:start`.
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      stopTyping();
    }, IDLE_STOP_MS);
  }, [stopTyping, wsid]);

  // Inbound — attach/detach when the workspace changes; tear down timers on unmount.
  useEffect(() => {
    // Capture the per-peer timer map at effect time so the cleanup closure
    // sees the same instance the effect used, even if React replaces the
    // ref before teardown.
    const inboundTimers = inboundTimersRef.current;

    const onStart = (data: { userId: string; name: string }) => {
      if (!data || data.userId === currentUserId) return;

      setTyping((prev) => {
        if (prev[data.userId]?.name === data.name) return prev;
        return { ...prev, [data.userId]: { name: data.name } };
      });

      // Restart the per-peer TTL — a peer's stop is best-effort, so the
      // expiry on its own is the source of truth.
      const existing = inboundTimers.get(data.userId);
      if (existing !== undefined) clearTimeout(existing);
      const timer = setTimeout(() => {
        inboundTimers.delete(data.userId);
        setTyping((prev) => {
          if (!(data.userId in prev)) return prev;
          const next = { ...prev };
          delete next[data.userId];
          return next;
        });
      }, INBOUND_TTL_MS);
      inboundTimers.set(data.userId, timer);
    };

    const onStop = (data: { userId: string }) => {
      if (!data || data.userId === currentUserId) return;

      const existing = inboundTimers.get(data.userId);
      if (existing !== undefined) {
        clearTimeout(existing);
        inboundTimers.delete(data.userId);
      }
      setTyping((prev) => {
        if (!(data.userId in prev)) return prev;
        const next = { ...prev };
        delete next[data.userId];
        return next;
      });
    };

    socket.on("typing:start", onStart);
    socket.on("typing:stop", onStop);

    return () => {
      socket.off("typing:start", onStart);
      socket.off("typing:stop", onStop);
      // Sweep any inbound TTL timers that were still live — they would
      // otherwise fire after unmount and try to call setState on a gone
      // component.
      for (const timer of inboundTimers.values()) {
        clearTimeout(timer);
      }
      inboundTimers.clear();
      // Stop on unmount — a peer that is mid-keystroke when the chat panel
      // closes should not leave a dangling indicator.
      stopTyping();
    };
    // stopTyping's identity is `wsid`-derived and changes with `wsid`, which
    // is the dependency that matters here.
  }, [currentUserId, stopTyping, wsid]);

  // Ordered list of names so the indicator can render "Ana and Ben are typing…"
  // without re-sorting inside the component on every render.
  const typingNames = Object.values(typing).map((entry) => entry.name);

  return { typing, typingNames, handleTypingInput, stopTyping };
}
