/**
 * @module ui/components/Logo
 * @description The Nimbus mark: two overlapping rounded squares with a lime
 * centre, optionally followed by the lowercase wordmark. Colours come from the
 * `--violet` and `--lime` tokens in `globals.css`.
 */

/** Props for {@link Logo}. */
type Props = {
  /** Mark size in pixels (the wordmark scales with it). Defaults to 30. */
  size?: number;
  /** Whether to render the "nimbus" wordmark beside the mark. Defaults to true. */
  wordmark?: boolean;
  /** Extra classes for the wrapper element. */
  className?: string;
};

/**
 * Brand mark with an optional wordmark. Decorative on its own: the wordmark
 * is the accessible name when shown.
 *
 * @param props.size - Mark size in pixels.
 * @param props.wordmark - Show the wordmark text.
 * @param props.className - Additional classes for the wrapper.
 */
export default function Logo({
  size = 30,
  wordmark = true,
  className = "",
}: Props) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect
          x="22"
          y="22"
          width="52"
          height="52"
          rx="14"
          fill="none"
          stroke="var(--violet)"
          strokeWidth="11"
        />
        <rect
          x="46"
          y="46"
          width="52"
          height="52"
          rx="14"
          fill="none"
          stroke="var(--violet)"
          strokeWidth="11"
        />
        <path
          d="M60 46 H74 V60 A14 14 0 0 1 60 74 H46 V60 A14 14 0 0 1 60 46 Z"
          fill="var(--lime)"
        />
      </svg>
      {wordmark && (
        <span
          className="font-mono font-bold tracking-[-0.03em]"
          style={{ fontSize: Math.round(size * 0.63) }}
        >
          nimbus
        </span>
      )}
    </span>
  );
}
