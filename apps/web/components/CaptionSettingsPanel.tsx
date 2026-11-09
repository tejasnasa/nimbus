"use client";

/**
 * @module web/components/CaptionSettingsPanel
 * @description The workspace settings "Captions" tab: how live captions look
 * for this viewer during a call (text size, high contrast, how many lines stay
 * on screen), with a preview drawn the way the captions bar will draw it.
 * Changes apply at once, including to a captions bar already on screen.
 *
 * @important The choice belongs to the viewer, not the workspace: it is kept
 *            per user in this browser and nobody else sees it.
 */
import Select from "@nimbus/ui/Select";
import {
  CAPTION_SIZE_CLASS,
  useCaptionPrefs,
  type CaptionSize,
} from "../hooks/useCaptionPrefs";

const SIZES: { value: CaptionSize; label: string }[] = [
  { value: "s", label: "Small" },
  { value: "m", label: "Medium" },
  { value: "l", label: "Large" },
];

const SAMPLE_LINES = [
  { speaker: "Ada", text: "Shall we go through the launch checklist?" },
  { speaker: "Grace", text: "Sure, the docs are ready for review." },
  { speaker: "Ada", text: "Great, I'll share the timeline next." },
  { speaker: "NimbusBot", text: "I've noted three action items so far." },
  { speaker: "Grace", text: "Can we move the demo to Thursday?" },
  { speaker: "Ada", text: "Thursday works, let's lock it in." },
];

/**
 * @param props.userId - The signed-in user whose caption choice is edited.
 */
export default function CaptionSettingsPanel({ userId }: { userId: string }) {
  const { prefs, update } = useCaptionPrefs(userId);

  const surface = prefs.highContrast
    ? "bg-black text-white border-white"
    : "bg-(--background)/90 text-(--foreground) border-(--border)";

  return (
    <div className="space-y-5" data-testid="caption-settings-panel">
      <p className="text-sm text-(--muted-foreground)">
        How live captions look for you during a call. This is saved in this
        browser and only affects what you see.
      </p>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Text size</h2>
        <div className="flex gap-2" role="group" aria-label="Text size">
          {SIZES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={prefs.size === value}
              data-testid={`caption-size-${value}`}
              onClick={() => update({ size: value })}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors hover:cursor-pointer ${
                prefs.size === value
                  ? "border-(--primary) bg-(--primary) text-(--primary-foreground)"
                  : "border-(--border) hover:bg-(--muted)"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm hover:cursor-pointer">
        <input
          type="checkbox"
          data-testid="caption-high-contrast"
          checked={prefs.highContrast}
          onChange={(e) => update({ highContrast: e.target.checked })}
        />
        High contrast (white on black)
      </label>

      <Select
        id="caption-lines"
        label="Lines on screen"
        value={String(prefs.lines)}
        onChange={(value) => update({ lines: value === "6" ? 6 : 3 })}
        options={[
          { value: "3", label: "3 lines" },
          { value: "6", label: "6 lines" },
        ]}
        className="max-w-48"
      />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Preview</h2>
        <div
          data-testid="caption-preview"
          className={`rounded-xl border p-3 shadow-lg ${surface}`}
        >
          <div
            className={`flex flex-col gap-1 ${CAPTION_SIZE_CLASS[prefs.size]}`}
          >
            {SAMPLE_LINES.slice(-prefs.lines).map((line, index) => (
              <p key={index} data-testid="caption-preview-line">
                <span className="font-semibold">{line.speaker}: </span>
                {line.text}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
