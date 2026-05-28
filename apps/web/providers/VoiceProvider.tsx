"use client";

import { VoiceUser } from "@nimbus/types";
import React, { createContext, useContext } from "react";
import { useVoiceChat, UseVoiceChatProps } from "../hooks/useVoiceChat";

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
