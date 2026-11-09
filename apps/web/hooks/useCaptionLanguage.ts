/**
 * @module web/hooks/useCaptionLanguage
 * @description Tells the server which language this browser wants live captions
 * in for a meeting, so it translates into that language and no other.
 *
 * It emits `meeting:caption-language` when the meeting or the chosen language
 * changes, again whenever the socket reconnects, and `null` when the viewer
 * leaves the meeting or the component unmounts.
 *
 * @important The server forgets a socket's choice the moment that socket
 *            disconnects, so the choice must be re-sent on every `connect`; a
 *            viewer who reconnects mid-call would otherwise silently stop
 *            receiving translations. Nothing is emitted while the socket is
 *            down, because Socket.IO would buffer it and replay it later, after
 *            the choice may have changed.
 */
"use client";

import { useEffect } from "react";
import { socket } from "../lib/socket";

/**
 * @param meetingId - The live meeting the viewer is in, or null when none.
 * @param language - The caption language code, or null for the original.
 */
export function useCaptionLanguage(
  meetingId: string | null,
  language: string | null,
): void {
  useEffect(() => {
    if (!meetingId) return;
    const announce = () => {
      if (socket.connected) {
        socket.emit("meeting:caption-language", { meetingId, language });
      }
    };
    announce();
    socket.on("connect", announce);
    return () => {
      socket.off("connect", announce);
    };
  }, [meetingId, language]);

  // Separate from the effect above so that changing language does not first
  // emit a clearing `null`, which could land after the new choice.
  useEffect(() => {
    if (!meetingId) return;
    return () => {
      if (socket.connected) {
        socket.emit("meeting:caption-language", { meetingId, language: null });
      }
    };
  }, [meetingId]);
}
