/**
 * @module web/providers/VoiceProvider
 * @description Thin context wrapper around `useVoiceChat`: runs the WebRTC
 * hook once per workspace and exposes its state + mute/deafen controls (plus
 * `localUser` identity) to voice UI components.
 */
"use client";

import { VoiceUser } from "@nimbus/types";
import React, { createContext, useContext } from "react";
import { useVoiceChat, UseVoiceChatProps } from "../hooks/useVoiceChat";

/** Voice state + controls consumed via `useVoice()`. */
interface VoiceContextType {
  isConnected: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  voiceUsers: VoiceUser[];
  speakingUsers: Set<string>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  localUser: { userId: string; name: string; image: string | null };
}

const VoiceContext = createContext<VoiceContextType | null>(null);

/**
 * Reads voice state; throws outside `VoiceProvider` to fail fast on
 * misplaced consumers.
 */
export function useVoice() {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error("useVoice must be used within a VoiceProvider");
  }
  return context;
}

interface VoiceProviderProps extends UseVoiceChatProps {
  children: React.ReactNode;
}

/**
 * Instantiates `useVoiceChat` for the workspace and publishes it via context.
 *
 * @param props - Identity + workspace (forwarded to the hook) and children.
 */
export function VoiceProvider({
  children,
  userId,
  userName,
  userImage,
  workspaceId,
}: VoiceProviderProps) {
  const voiceState = useVoiceChat({
    userId,
    userName,
    userImage,
    workspaceId,
  });

  return (
    <VoiceContext.Provider
      value={{
        ...voiceState,
        localUser: { userId, name: userName, image: userImage },
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}
