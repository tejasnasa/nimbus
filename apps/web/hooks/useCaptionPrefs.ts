/**
 * @module web/hooks/useCaptionPrefs
 * @description How a viewer wants live captions to look (text size, contrast,
 * number of lines), remembered per user in the browser. Edited from the
 * workspace settings Captions tab and read by the captions bar over the call.
 *
 * Every instance of the hook stays in step: a change broadcasts a window event
 * so a captions bar already on screen restyles while the settings dialog is
 * still open, and the `storage` event carries the change to other tabs.
 *
 * @important Preferences live in `localStorage`, read and written inside
 *            try/catch. A browser that blocks storage gets the defaults, and a
 *            change lasts until the page closes; nothing else breaks.
 */
"use client";

import { useCallback, useEffect, useState } from "react";

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

/** Tailwind text size for each caption size. */
export const CAPTION_SIZE_CLASS: Record<CaptionSize, string> = {
  s: "text-xs",
  m: "text-sm",
  l: "text-lg",
};

/** Same-tab broadcast; `storage` only fires in other tabs. */
const CHANGE_EVENT = "nimbus:caption-prefs";

/** The key a user's caption preferences are stored under. */
export function prefsKey(userId: string | undefined): string {
  return `nimbus:captions:${userId ?? "anonymous"}`;
}

/** Reads stored preferences, falling back to defaults on anything unusable. */
export function readPrefs(key: string): CaptionPrefs {
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

/**
 * @param userId - The signed-in user; preferences are kept per user.
 * @returns The current preferences and a function that changes some of them.
 */
export function useCaptionPrefs(userId: string | undefined): {
  prefs: CaptionPrefs;
  update: (patch: Partial<CaptionPrefs>) => void;
} {
  const key = prefsKey(userId);
  const [prefs, setPrefs] = useState<CaptionPrefs>(DEFAULT_CAPTION_PREFS);

  useEffect(() => {
    setPrefs(readPrefs(key));

    const onLocal = (event: Event) => {
      const detail = (
        event as CustomEvent<{ key: string; prefs: CaptionPrefs }>
      ).detail;
      if (detail?.key === key) setPrefs(detail.prefs);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) setPrefs(readPrefs(key));
    };
    window.addEventListener(CHANGE_EVENT, onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);

  const update = useCallback(
    (patch: Partial<CaptionPrefs>) => {
      setPrefs((current) => {
        const next = { ...current, ...patch };
        writePrefs(key, next);
        // Deferred so listeners update outside this state transition.
        queueMicrotask(() =>
          window.dispatchEvent(
            new CustomEvent(CHANGE_EVENT, { detail: { key, prefs: next } }),
          ),
        );
        return next;
      });
    },
    [key],
  );

  return { prefs, update };
}
