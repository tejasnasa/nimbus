/**
 * @module web/hooks/useMeeting
 * @description Owns the client's view of a workspace's in-call assistant: the
 * live meeting, its captions in sequence order, what the assistant is doing,
 * who it hears speaking, and the start and stop actions.
 *
 * On mount it asks the API for the live meeting and, when there is one, pages
 * its transcript so a late joiner sees what was said. After that the socket
 * keeps it current (`meeting:started|ended|assistant-state|speaking|segment|
 * translation`).
 *
 * @important Captions are inserted by sequence number and deduplicated, so a
 *            segment that arrives over the socket while the first page is still
 *            loading, or twice after a reconnect, appears once and in order.
 *
 * @important Translations are kept apart from the segments, keyed by
 *            `seq` and language ({@link translationKey}), so a translation that
 *            arrives before its caption, or for a language the viewer has since
 *            left, is harmless: the bar looks up only the pair it needs and
 *            falls back to the original text when there is none. They are
 *            cleared when a different meeting starts.
 *
 * @important A refusal to start (`refusal`) is kept apart from `error`: it
 *            names a reason with a settings fix, while an error is transient.
 */
"use client";

import type {
  AssistantRefusalDTO,
  AssistantState,
  MeetingDTO,
  MeetingEndReason,
  SegmentDTO,
} from "@nimbus/types";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchLiveMeeting,
  fetchSegments,
  startAssistant,
  stopAssistant,
} from "../lib/meetingApi";
import { socket } from "../lib/socket";

/** A start the server refused, with the copy to show. */
export type StartRefusal = AssistantRefusalDTO & { message: string };

/** What {@link useMeeting} publishes. */
export interface MeetingState {
  /** The live meeting, or null when the assistant is not in the call. */
  meeting: MeetingDTO | null;
  /** Captions of the current (or most recent) meeting, in sequence order. */
  segments: SegmentDTO[];
  /** Live translations received, by {@link translationKey}. */
  translations: Record<string, string>;
  assistantState: AssistantState | null;
  /** User ids the assistant hears speaking right now. */
  speakingUserIds: string[];
  /** Why the most recent meeting ended, until the next one starts. */
  endReason: MeetingEndReason | null;
  /** A start or stop request is in flight. */
  isPending: boolean;
  refusal: StartRefusal | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/** Inert value for components rendered outside a provider. */
export const NO_MEETING: MeetingState = {
  meeting: null,
  segments: [],
  translations: {},
  assistantState: null,
  speakingUserIds: [],
  endReason: null,
  isPending: false,
  refusal: null,
  error: null,
  start: async () => {},
  stop: async () => {},
};

/**
 * The key a live translation is stored under.
 *
 * @param seq - The caption's sequence number.
 * @param language - The translation's language code.
 */
export function translationKey(seq: number, language: string): string {
  return `${seq}:${language}`;
}

/**
 * Inserts a caption by sequence number, ignoring one already present.
 *
 * @param list - Captions in sequence order.
 * @param incoming - The new caption.
 * @returns The same array when nothing changed, otherwise a new ordered one.
 */
export function insertSegment(
  list: SegmentDTO[],
  incoming: SegmentDTO,
): SegmentDTO[] {
  if (list.some((s) => s.seq === incoming.seq)) return list;
  const next = [...list, incoming];
  next.sort((a, b) => a.seq - b.seq);
  return next;
}

/**
 * Tracks the workspace's assistant meeting.
 *
 * @param workspaceId - The workspace cuid.
 */
export function useMeeting(workspaceId: string): MeetingState {
  const [meeting, setMeeting] = useState<MeetingDTO | null>(null);
  const [segments, setSegments] = useState<SegmentDTO[]>([]);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [assistantState, setAssistantState] = useState<AssistantState | null>(
    null,
  );
  const [speakingUserIds, setSpeakingUserIds] = useState<string[]>([]);
  const [endReason, setEndReason] = useState<MeetingEndReason | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [refusal, setRefusal] = useState<StartRefusal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meetingIdRef = useRef<string | null>(null);

  const adopt = useCallback((next: MeetingDTO) => {
    if (meetingIdRef.current !== next.id) {
      meetingIdRef.current = next.id;
      setSegments([]);
      setTranslations({});
      setSpeakingUserIds([]);
    }
    setMeeting(next);
    setEndReason(null);
    setAssistantState((current) => current ?? "joining");
  }, []);

  const loadTranscript = useCallback(async (meetingId: string) => {
    let after = 0;
    // Bounded so a misbehaving server cannot hold the loop open.
    for (let page = 0; page < 50; page++) {
      const res = await fetchSegments(meetingId, after);
      if (!res.ok || meetingIdRef.current !== meetingId) return;
      const { segments: batch, hasMore } = res.data;
      if (batch.length === 0) return;
      setSegments((current) => batch.reduce(insertSegment, current));
      after = batch[batch.length - 1]!.seq;
      if (!hasMore) return;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchLiveMeeting(workspaceId).then((res) => {
      if (cancelled || !res.ok || !res.data.meeting) return;
      adopt(res.data.meeting);
      void loadTranscript(res.data.meeting.id);
    });

    const onStarted = (started: MeetingDTO) => {
      if (started.workspaceId !== workspaceId) return;
      adopt(started);
    };
    const onEnded = (data: { meetingId: string; reason: MeetingEndReason }) => {
      if (data.meetingId !== meetingIdRef.current) return;
      setMeeting(null);
      setAssistantState(null);
      setSpeakingUserIds([]);
      setEndReason(data.reason);
    };
    const onState = (data: { meetingId: string; state: AssistantState }) => {
      if (data.meetingId !== meetingIdRef.current) return;
      setAssistantState(data.state);
    };
    const onSpeaking = (data: { meetingId: string; userIds: string[] }) => {
      if (data.meetingId !== meetingIdRef.current) return;
      setSpeakingUserIds(data.userIds);
    };
    const onSegment = (data: { meetingId: string; segment: SegmentDTO }) => {
      if (data.meetingId !== meetingIdRef.current) return;
      setSegments((current) => insertSegment(current, data.segment));
    };

    const onTranslation = (data: {
      meetingId: string;
      seq: number;
      language: string;
      text: string;
    }) => {
      if (data.meetingId !== meetingIdRef.current) return;
      setTranslations((current) => ({
        ...current,
        [translationKey(data.seq, data.language)]: data.text,
      }));
    };

    socket.on("meeting:started", onStarted);
    socket.on("meeting:ended", onEnded);
    socket.on("meeting:assistant-state", onState);
    socket.on("meeting:speaking", onSpeaking);
    socket.on("meeting:segment", onSegment);
    socket.on("meeting:translation", onTranslation);
    return () => {
      cancelled = true;
      socket.off("meeting:started", onStarted);
      socket.off("meeting:ended", onEnded);
      socket.off("meeting:assistant-state", onState);
      socket.off("meeting:speaking", onSpeaking);
      socket.off("meeting:segment", onSegment);
      socket.off("meeting:translation", onTranslation);
    };
  }, [workspaceId, adopt, loadTranscript]);

  const start = useCallback(async () => {
    setIsPending(true);
    setError(null);
    setRefusal(null);
    const res = await startAssistant(workspaceId);
    if (res.ok) {
      adopt(res.data);
    } else if (res.refusal) {
      setRefusal({ ...res.refusal, message: res.message });
    } else {
      setError(res.message);
    }
    setIsPending(false);
  }, [workspaceId, adopt]);

  const stop = useCallback(async () => {
    const id = meetingIdRef.current;
    if (!id) return;
    setIsPending(true);
    setError(null);
    const res = await stopAssistant(id);
    if (!res.ok) setError(res.message);
    setIsPending(false);
  }, []);

  return {
    meeting,
    segments,
    translations,
    assistantState,
    speakingUserIds,
    endReason,
    isPending,
    refusal,
    error,
    start,
    stop,
  };
}
