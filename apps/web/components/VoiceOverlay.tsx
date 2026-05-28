"use client";

import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import { useEffect, useState } from "react";
import { useVoice } from "../providers/VoiceProvider";

interface SpeakerInfo {
  userId: string;
  name: string;
  image: string | null;
  lastSpoke: number;
}

export default function VoiceOverlay() {
  const { speakingUsers, voiceUsers, localUser } = useVoice();
  const [activeSpeakers, setActiveSpeakers] = useState<
    Map<string, SpeakerInfo>
  >(new Map());

  useEffect(() => {
    if (speakingUsers.size === 0) return;

    setActiveSpeakers((prev) => {
      const next = new Map(prev);
      speakingUsers.forEach((userId) => {
        let name = "Peer";
        let image: string | null = null;

        if (userId === localUser.userId) {
          name = localUser.name;
          image = localUser.image;
        } else {
          const user = voiceUsers.find((u) => u.userId === userId);
          if (user) {
            name = user.name;
            image = user.image;
          }
        }

        next.set(userId, {
          userId,
          name,
          image,
          lastSpoke: Date.now(),
        });
      });
      return next;
    });
  }, [speakingUsers, voiceUsers, localUser]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let changed = false;

      setActiveSpeakers((prev) => {
        const next = new Map(prev);
        next.forEach((speaker, userId) => {
          if (now - speaker.lastSpoke > 1500) {
            next.delete(userId);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const speakersList = Array.from(activeSpeakers.values());

  if (speakersList.length === 0) return null;

  return (
    <div className="absolute top-4 right-4 z-50 flex flex-col gap-3 pointer-events-none">
      {speakersList.map((speaker) => (
        <div
          key={speaker.userId}
          className="flex items-center gap-3 bg-(--background)/85 backdrop-blur-md px-3 py-2 rounded-full border border-emerald-500/30 shadow-[0_4px_16px_rgba(16,185,129,0.15)] animate-fade-in transition-all duration-300 transform scale-100 hover:scale-105"
        >
          <div className="relative">
            <div className="absolute -inset-1 rounded-full bg-emerald-500/20 animate-ping opacity-75" />
            <img
              src={speaker.image || getAvatarForUser(speaker.userId)}
              alt={speaker.name}
              className="w-10 h-10 rounded-full border-2 border-emerald-500 object-cover shadow-[0_0_12px_rgba(16,185,129,0.4)]"
            />
          </div>

          <div className="flex flex-col pr-2">
            <span className="text-xs font-semibold text-emerald-400">
              {speaker.name}
            </span>
            <span className="text-[9px] text-(--muted-foreground)/80 uppercase tracking-wider font-semibold">
              Speaking
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
