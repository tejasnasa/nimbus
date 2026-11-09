/**
 * @module web/components/VoiceOverlay
 * @description Floating speaking-indicator badges (top-right): avatars appear
 * when a participant starts speaking and linger 1.5s after they stop (swept on
 * a 100ms interval), so brief pauses don't flicker the UI. Participants come
 * from the call room, and the assistant is marked with an "Agent" badge, told
 * apart by the participant kind LiveKit reports rather than by name.
 * Pointer-events-none overlay; renders no badges when nobody is speaking. Live
 * captions share this layer while the assistant is in the call.
 *
 * @important Identity is read from the live participant list at render time;
 *            the map only carries who is speaking and when they last did. A
 *            badge outlives the moment it appeared, so a snapshot of the avatar
 *            taken back then would pin the fallback picture for as long as the
 *            badge lives.
 */
"use client";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useVoice } from "../providers/VoiceProvider";
import CaptionsBar from "./meeting/CaptionsBar";

/** Visible speaker with `Infinity` lastSpoke while actively talking. */
interface SpeakerInfo {
  userId: string;
  name: string;
  image: string | null;
  isAgent: boolean;
  lastSpoke: number;
}

export default function VoiceOverlay() {
  const { speakingUsers, participants } = useVoice();
  const [activeSpeakers, setActiveSpeakers] = useState<
    Map<string, SpeakerInfo>
  >(new Map());
  const prevSpeakingRef = useRef<Set<string>>(new Set());

  // Diff the talking set: newcomers appear instantly (Infinity = "talking now"),
  // quitters stamp Date.now() so the sweeper below can linger them 1.5s.
  // No-op when nothing changed to avoid churning the speaker map.
  useEffect(() => {
    const prev = prevSpeakingRef.current;
    const next = new Set(speakingUsers);

    const started = [...next].filter((id) => !prev.has(id));
    const stopped = [...prev].filter((id) => !next.has(id));

    if (started.length === 0 && stopped.length === 0) return;

    setActiveSpeakers((prevMap) => {
      const updated = new Map(prevMap);

      started.forEach((userId) => {
        const who = participants.find((p) => p.userId === userId);
        updated.set(userId, {
          userId,
          name: who?.name ?? "Peer",
          image: who?.image ?? null,
          isAgent: who?.isAgent ?? false,
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
  }, [speakingUsers, participants]);

  // Sweep every 100ms: evict speakers silent >1.5s. Identity-preserving
  // (returns prev when unchanged) to avoid re-rendering on every tick.
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
  const badges =
    speakersList.length === 0 ? null : (
      <div className="absolute top-8 right-8 z-50 flex flex-col pointer-events-none">
        {speakersList.map((speaker) => {
          // Read the participant now rather than trusting the snapshot taken when
          // they started speaking: an avatar can land after that moment, and the
          // frozen copy would pin the fallback for the badge's whole life. A
          // speaker who has already left is gone from the list, so the snapshot
          // is still what the 1.5s linger shows.
          const live = participants.find((p) => p.userId === speaker.userId);
          const name = live ? live.name : speaker.name;
          const image = live ? live.image : speaker.image;
          const isAgent = live ? live.isAgent : speaker.isAgent;

          return (
            <div
              key={speaker.userId}
              className="flex items-center bg-(--background)/85 backdrop-blur-md p-1 rounded-full border border-(--chart-3)/30 shadow-[0_4px_16px_rgba(16,185,129,0.15)] animate-fade-in transition-all duration-300 transform scale-100 hover:scale-105"
            >
              <div className="relative">
                <div className="absolute -inset-1 rounded-full bg-(--chart-3)/20 animate-ping opacity-75" />
                {/* `unoptimized`: avatars come from arbitrary hosts, so none can be
                  pre-registered for the image optimiser. */}
                <Image
                  src={image || getAvatarForUser(speaker.userId)}
                  alt={name}
                  width={40}
                  height={40}
                  unoptimized
                  className="w-10 h-10 rounded-full border-2 border-(--chart-3) object-cover shadow-[0_0_12px_rgba(16,185,129,0.4)]"
                />
                {isAgent && (
                  <span className="absolute -bottom-1 -right-1 rounded-full bg-(--primary) px-1.5 text-[9px] font-semibold uppercase leading-4 text-(--primary-foreground)">
                    Agent
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );

  return (
    <>
      <CaptionsBar />
      {badges}
    </>
  );
}
