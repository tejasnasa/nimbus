/**
 * @module web/components/meeting/CaptionsBar
 * @description Live captions over the call: the latest few lines of the
 * meeting's transcript with the speaker's name, and a "Name is speaking..."
 * line for whoever the assistant hears right now. Text size, contrast and the
 * number of lines follow the viewer's choice in the workspace settings Captions
 * tab, and restyle live when that choice changes mid-call.
 *
 * Lines the assistant spoke are set apart: tinted, italic and marked with
 * `data-from-assistant`, so a spoken answer never reads as a person's words.
 *
 * When the viewer picked a caption language, each line shows its translation
 * once it arrives and the original text until then. Hovering or focusing a
 * translated line shows the original beneath it.
 *
 * Above the captions, a dismissible "Catch me up" card (`CatchUpCard`) is offered
 * once the meeting is more than two minutes old.
 *
 * Mounting the bar is what subscribes the viewer to translation: it reports the
 * chosen language to the server for as long as it is on screen, including when
 * the choice is changed from the settings tab during the call.
 *
 * @important The caption list is an `aria-live="polite"` region, so a screen
 *            reader announces new lines without interrupting what it is
 *            already saying. The "is speaking" line is deliberately outside
 *            that region: it changes many times a second and would drown the
 *            captions out.
 */
"use client";

import type { SegmentDTO } from "@nimbus/types";
import { useState } from "react";
import { useCaptionLanguage } from "../../hooks/useCaptionLanguage";
import {
  CAPTION_SIZE_CLASS,
  useCaptionPrefs,
} from "../../hooks/useCaptionPrefs";
import { translationKey } from "../../hooks/useMeeting";
import { useAssistant } from "../../providers/MeetingProvider";
import { useVoice } from "../../providers/VoiceProvider";
import CatchUpCard from "./CatchUpCard";

/**
 * One caption. A translated line is focusable so keyboard and touch users can
 * reach the original the same way a pointer user hovers it.
 */
function CaptionLine({
  segment,
  translation,
}: {
  segment: SegmentDTO;
  translation: string | undefined;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const fromAssistant = segment.fromAssistant === true;
  const voice = fromAssistant ? "italic text-(--primary)" : "";

  if (!translation) {
    return (
      <p
        data-testid="caption-line"
        data-from-assistant={fromAssistant || undefined}
        className={voice}
      >
        <span className="font-semibold">{segment.speakerName}: </span>
        {segment.text}
      </p>
    );
  }

  return (
    <p
      data-testid="caption-line"
      data-from-assistant={fromAssistant || undefined}
      tabIndex={0}
      title={`Original: ${segment.text}`}
      onMouseEnter={() => setShowOriginal(true)}
      onMouseLeave={() => setShowOriginal(false)}
      onFocus={() => setShowOriginal(true)}
      onBlur={() => setShowOriginal(false)}
      className={`rounded-sm outline-offset-2 focus-visible:outline focus-visible:outline-2 ${voice}`}
    >
      <span className="font-semibold">{segment.speakerName}: </span>
      <span data-testid="caption-translation">{translation}</span>
      {showOriginal && (
        <span
          data-testid="caption-original"
          className="mt-0.5 block text-[0.85em] italic opacity-70"
        >
          Original: {segment.text}
        </span>
      )}
    </p>
  );
}

export default function CaptionsBar() {
  const { meeting, segments, translations, speakingUserIds } = useAssistant();
  const { participants } = useVoice();
  const me = participants.find((p) => p.isLocal);
  const { prefs } = useCaptionPrefs(me?.userId);
  useCaptionLanguage(meeting && me ? meeting.id : null, prefs.language);

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
      <CatchUpCard />
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
            <CaptionLine
              key={segment.seq}
              segment={segment}
              translation={
                prefs.language
                  ? translations[translationKey(segment.seq, prefs.language)]
                  : undefined
              }
            />
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
