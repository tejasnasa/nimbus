"use client";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import { useEffect, useRef, useState } from "react";
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
  const prevSpeakingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevSpeakingRef.current;
    const next = new Set(speakingUsers);

    const started = [...next].filter((id) => !prev.has(id));
    const stopped = [...prev].filter((id) => !next.has(id));

    if (started.length === 0 && stopped.length === 0) return;

    setActiveSpeakers((prevMap) => {
      const updated = new Map(prevMap);

      started.forEach((userId) => {
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
        updated.set(userId, {
          userId,
          name,
          image,
          lastSpoke: Infinity,
        });
      });

      stopped.forEach((userId) => {
        const existing = updated.get(userId);
        if (existing) {
          updated.set(userId, { ...existing, lastSpoke: Date.now() });
        }
      });

      return updated;
    });

    prevSpeakingRef.current = next;
  }, [speakingUsers, voiceUsers, localUser]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setActiveSpeakers((prev) => {
        let changed = false;
        const next = new Map(prev);
        next.forEach((speaker, userId) => {
          if (
            speaker.lastSpoke !== Infinity &&
            now - speaker.lastSpoke > 1500
          ) {
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
    <div className="absolute top-8 right-8 z-50 flex flex-col pointer-events-none">
      {speakersList.map((speaker) => (
        <div
          key={speaker.userId}
          className="flex items-center bg-(--background)/85 backdrop-blur-md p-1 rounded-full border border-(--chart-3)/30 shadow-[0_4px_16px_rgba(16,185,129,0.15)] animate-fade-in transition-all duration-300 transform scale-100 hover:scale-105"
        >
          <div className="relative">
            <div className="absolute -inset-1 rounded-full bg-(--chart-3)/20 animate-ping opacity-75" />
            <img
              src={speaker.image || getAvatarForUser(speaker.userId)}
              alt={speaker.name}
              className="w-10 h-10 rounded-full border-2 border-(--chart-3) object-cover shadow-[0_0_12px_rgba(16,185,129,0.4)]"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
