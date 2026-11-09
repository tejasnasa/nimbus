/**
 * @module api/socket/meeting
 * @description Socket handlers for the in-call assistant's meetings: a viewer
 * choosing the language they want live captions in.
 *
 * @important Membership of the meeting's workspace is checked on every
 *            `meeting:caption-language`, not once at join, so a removed member's
 *            next change is refused. Only a live meeting accepts a language;
 *            clearing one needs no check because it can only remove the socket's
 *            own entry.
 *
 * @important A socket holds at most one subscription. Choosing a language for
 *            another meeting, or disconnecting, removes the previous entry from
 *            the Redis hash, so a viewer who has left never keeps a language
 *            "active" and costing translation calls.
 */
import { prisma } from "@nimbus/db";
import { captionLanguageSchema } from "@nimbus/types";
import { isCaptionLanguage } from "@nimbus/utils";
import type { Server, Socket } from "socket.io";
import { requireWorkspaceRole } from "../lib/workspaceAccess";
import {
  clearCaptionLanguage,
  setCaptionLanguage,
} from "../lib/meeting/captionLanguages";

/**
 * Registers the meeting handlers for one socket.
 *
 * @param _io - The Socket.IO server; unused, kept for parity with the other registrars.
 * @param socket - An authenticated socket (`socket.data.user` is set).
 */
export const registerMeetingHandlers = (_io: Server, socket: Socket) => {
  const user = socket.data.user;
  let subscribedTo: string | null = null;

  const unsubscribe = async () => {
    const meetingId = subscribedTo;
    subscribedTo = null;
    if (meetingId) await clearCaptionLanguage(meetingId, socket.id);
  };

  socket.on("meeting:caption-language", async (payload: unknown) => {
    try {
      const parsed = captionLanguageSchema.safeParse(payload);
      if (!parsed.success) return;
      const { meetingId, language } = parsed.data;

      if (language === null) {
        await clearCaptionLanguage(meetingId, socket.id);
        if (subscribedTo === meetingId) subscribedTo = null;
        return;
      }
      if (!isCaptionLanguage(language)) return;

      const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { workspaceId: true, status: true },
      });
      if (!meeting || meeting.status !== "LIVE") return;
      const access = await requireWorkspaceRole(user.id, meeting.workspaceId);
      if (!access.ok) return;

      if (subscribedTo && subscribedTo !== meetingId) await unsubscribe();
      subscribedTo = meetingId;
      await setCaptionLanguage(meetingId, socket.id, language);
      // The socket may have dropped while the checks above were in flight.
      if (socket.disconnected) await unsubscribe();
    } catch (error) {
      console.error(
        "[meeting] caption language change failed:",
        error instanceof Error ? error.name : "unknown error",
      );
    }
  });

  socket.on("disconnect", () => {
    void unsubscribe().catch(() => undefined);
  });
};
