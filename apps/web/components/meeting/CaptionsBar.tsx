/**
 * @module web/components/meeting/CaptionsBar
 * @description Live captions over the call: the latest few lines of the
 * meeting's transcript with the speaker's name, and a "Name is speaking..."
 * line for whoever the assistant hears right now. Text size, contrast and the
 * number of lines follow the viewer's choice in the workspace settings Captions
 * tab, and restyle live when that choice changes mid-call.
 *
 * @important The caption list is an `aria-live="polite"` region, so a screen
 *            reader announces new lines without interrupting what it is
 *            already saying. The "is speaking" line is deliberately outside
 *            that region: it changes many times a second and would drown the
 *            captions out.
 */
"use client";

import {
  CAPTION_SIZE_CLASS,
  useCaptionPrefs,
} from "../../hooks/useCaptionPrefs";
import { useAssistant } from "../../providers/MeetingProvider";
import { useVoice } from "../../providers/VoiceProvider";

export default function CaptionsBar() {
  const { meeting, segments, speakingUserIds } = useAssistant();
  const { participants } = useVoice();
  const me = participants.find((p) => p.isLocal);
  const { prefs } = useCaptionPrefs(me?.userId);

  if (!meeting || !me) return null;

  const visible = segments.slice(-prefs.lines);
  const speakingNames = speakingUserIds
    .map((id) => participants.find((p) => p.userId === id)?.name)
    .filter((name): name is string => Boolean(name));

  const surface = prefs.highContrast
    ? "bg-black text-white border-white"
    : "bg-(--background)/90 text-(--foreground) border-(--border)";

  return (
    <div className="absolute bottom-6 left-1/2 z-50 w-[min(42rem,calc(100%-2rem))] -translate-x-1/2">
      <div
        className={`rounded-xl border p-3 shadow-lg backdrop-blur-md ${surface}`}
      >
        <div
          data-testid="captions"
          aria-live="polite"
          aria-label="Live captions"
          role="log"
          className={`flex min-w-0 flex-col gap-1 ${CAPTION_SIZE_CLASS[prefs.size]}`}
        >
          {visible.length === 0 && (
            <p className="opacity-70">Captions will appear here.</p>
          )}
          {visible.map((segment) => (
            <p key={segment.seq} data-testid="caption-line">
              <span className="font-semibold">{segment.speakerName}: </span>
              {segment.text}
            </p>
          ))}
        </div>
        {speakingNames.length > 0 && (
          <p data-testid="speaking-line" className="mt-1 text-xs opacity-70">
            {speakingNames.join(", ")}{" "}
            {speakingNames.length === 1 ? "is" : "are"} speaking...
          </p>
        )}
      </div>
    </div>
  );
}
