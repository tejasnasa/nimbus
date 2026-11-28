/**
 * @module web/components/VoiceOverlay
 * @description Floating speaking-indicator badges (top-right, below the
 * canvas controls): avatars appear when a participant starts speaking and
 * linger 1.5s after they stop (swept on a 100ms interval), so brief pauses
 * don't flicker the UI. Participants come
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
import { avatarFor } from "../lib/nimbusAvatar";
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
      <div className="absolute top-16 right-5 z-50 flex flex-col gap-2 pointer-events-none">
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
              className="flex items-center gap-2 rounded-full border border-(--line-3) bg-(--surface-1)/90 py-1.25 pr-2.5 pl-1.25 font-sans animate-fade-in backdrop-blur-md"
            >
              {/* `unoptimized`: avatars come from arbitrary hosts, so none can be
                  pre-registered for the image optimiser. */}
              <Image
                src={avatarFor(speaker.userId, image, isAgent)}
                alt={name}
                width={26}
                height={26}
                unoptimized
                className="size-6.5 rounded-full object-cover ring-2 ring-(--lime)"
              />
              <span className="text-xs text-(--foreground)">{name}</span>
              {isAgent && (
                <span
                  data-testid="agent-badge"
                  className="rounded-[5px] bg-(--lime)/15 px-1.5 py-px font-mono text-[10px] text-lime-400"
                >
                  Agent
                </span>
              )}
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
