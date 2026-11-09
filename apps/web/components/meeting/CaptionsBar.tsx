/**
 * @module web/components/meeting/CaptionsBar
 * @description Live captions over the call: the latest few lines of the
 * meeting's transcript with the speaker's name, and a "Name is speaking..."
 * line for whoever the assistant hears right now. A small settings popover
 * changes the text size, contrast and number of lines; the choice is remembered
 * per user in the browser.
 *
 * @important The caption list is an `aria-live="polite"` region, so a screen
 *            reader announces new lines without interrupting what it is
 *            already saying. The "is speaking" line is deliberately outside
 *            that region: it changes many times a second and would drown the
 *            captions out.
 *
 * @important Preferences live in `localStorage`, read and written inside
 *            try/catch. A browser that blocks storage gets the defaults and
 *            loses nothing else.
 */
"use client";

import { useEffect, useState } from "react";
import { useAssistant } from "../../providers/MeetingProvider";
import { useVoice } from "../../providers/VoiceProvider";

export type CaptionSize = "s" | "m" | "l";

/** What the viewer chose for how captions look. */
export interface CaptionPrefs {
  size: CaptionSize;
  highContrast: boolean;
  lines: 3 | 6;
}

export const DEFAULT_CAPTION_PREFS: CaptionPrefs = {
  size: "m",
  highContrast: false,
  lines: 3,
};

const SIZE_CLASS: Record<CaptionSize, string> = {
  s: "text-xs",
  m: "text-sm",
  l: "text-lg",
};

/** The key a user's caption preferences are stored under. */
export function prefsKey(userId: string | undefined): string {
  return `nimbus:captions:${userId ?? "anonymous"}`;
}

/** Reads stored preferences, falling back to defaults on anything unusable. */
function readPrefs(key: string): CaptionPrefs {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return DEFAULT_CAPTION_PREFS;
    const parsed = JSON.parse(raw) as Partial<CaptionPrefs>;
    return {
      size:
        parsed.size === "s" || parsed.size === "m" || parsed.size === "l"
          ? parsed.size
          : DEFAULT_CAPTION_PREFS.size,
      highContrast: parsed.highContrast === true,
      lines: parsed.lines === 6 ? 6 : 3,
    };
  } catch {
    return DEFAULT_CAPTION_PREFS;
  }
}

function writePrefs(key: string, prefs: CaptionPrefs) {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // Storage is unavailable; the choice lasts until the page closes.
  }
}

export default function CaptionsBar() {
  const { meeting, segments, speakingUserIds } = useAssistant();
  const { participants } = useVoice();
  const me = participants.find((p) => p.isLocal);
  const key = prefsKey(me?.userId);

  const [prefs, setPrefs] = useState<CaptionPrefs>(DEFAULT_CAPTION_PREFS);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setPrefs(readPrefs(key));
  }, [key]);

  const update = (patch: Partial<CaptionPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writePrefs(key, next);
  };

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
        <div className="flex items-start justify-between gap-2">
          <div
            data-testid="captions"
            aria-live="polite"
            aria-label="Live captions"
            role="log"
            className={`flex min-w-0 flex-1 flex-col gap-1 ${SIZE_CLASS[prefs.size]}`}
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
          <button
            type="button"
            aria-label="Caption settings"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-md px-2 py-1 text-xs hover:cursor-pointer hover:bg-(--muted)"
          >
            Aa
          </button>
        </div>
        {speakingNames.length > 0 && (
          <p data-testid="speaking-line" className="mt-1 text-xs opacity-70">
            {speakingNames.join(", ")}{" "}
            {speakingNames.length === 1 ? "is" : "are"} speaking...
          </p>
        )}
        {open && (
          <div
            role="group"
            aria-label="Caption settings"
            className="mt-2 flex flex-wrap items-center gap-3 border-t border-(--border) pt-2 text-xs"
          >
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label="Text size"
            >
              {(["s", "m", "l"] as const).map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={prefs.size === size}
                  onClick={() => update({ size })}
                  className={`rounded px-2 py-0.5 hover:cursor-pointer ${
                    prefs.size === size
                      ? "bg-(--primary) text-(--primary-foreground)"
                      : "hover:bg-(--muted)"
                  }`}
                >
                  {size.toUpperCase()}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1 hover:cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.highContrast}
                onChange={(e) => update({ highContrast: e.target.checked })}
              />
              High contrast
            </label>
            <label className="flex items-center gap-1 hover:cursor-pointer">
              Lines
              <select
                value={prefs.lines}
                onChange={(e) =>
                  update({ lines: e.target.value === "6" ? 6 : 3 })
                }
                className="rounded border border-(--border) bg-transparent px-1"
              >
                <option value={3}>3</option>
                <option value={6}>6</option>
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
