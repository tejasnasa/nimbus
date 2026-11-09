/**
 * @module web/providers/MeetingProvider
 * @description Shares one {@link useMeeting} instance across the call controls,
 * the caption bar and the transcript panel, so they never disagree about
 * whether the assistant is in the call.
 *
 * @important `useAssistant` returns an inert "no meeting" value outside the
 *            provider instead of throwing: the call UI renders in places that
 *            have no workspace meeting to track, and a missing provider should
 *            mean "no assistant", not a crashed page.
 */
"use client";

import React, { createContext, useContext } from "react";
import { NO_MEETING, useMeeting, type MeetingState } from "../hooks/useMeeting";

const MeetingContext = createContext<MeetingState>(NO_MEETING);

/**
 * Tracks the workspace's assistant meeting for everything below it.
 *
 * @param props.workspaceId - The workspace cuid.
 * @param props.children - The tree that reads the shared state.
 */
export function MeetingProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: React.ReactNode;
}) {
  const state = useMeeting(workspaceId);
  return (
    <MeetingContext.Provider value={state}>{children}</MeetingContext.Provider>
  );
}

/** Reads the shared assistant state. */
export function useAssistant(): MeetingState {
  return useContext(MeetingContext);
}
