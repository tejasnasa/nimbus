/**
 * @module ui/components/LogoSpinner
 * @description Loading indicator built from the Nimbus mark: the two squares
 * turn slowly while the lime centre stays put. The label is announced to
 * screen readers through `role="status"` and is visually hidden unless
 * `showLabel` is set. `centered` turns it into a block that sits in the middle
 * of its container, for a panel that has nothing else to show yet.
 * @important Under `prefers-reduced-motion` the mark pulses instead of turning.
 */

/** Props for {@link LogoSpinner}. */
type Props = {
  /** What is loading, read out by assistive technology. */
  label: string;
  /** Mark size in pixels. Defaults to 28. */
  size?: number;
  /** Render the label beside the mark as well. Defaults to false. */
  showLabel?: boolean;
  /** Fill the container's width and centre the mark. Defaults to false. */
  centered?: boolean;
  /** Extra classes for the wrapper element. */
  className?: string;
};

/**
 * Renders the spinning Nimbus mark as a status region.
 *
 * @param props.label - Accessible description of what is loading.
 * @param props.size - Mark size in pixels.
 * @param props.showLabel - Show the label text next to the mark.
 * @param props.centered - Centre the mark in a full-width block.
 * @param props.className - Additional classes for the wrapper.
 */
export default function LogoSpinner({
  label,
  size = 28,
  showLabel = false,
  centered = false,
  className = "",
}: Props) {
  return (
    <span
      role="status"
      className={`items-center gap-2.5 text-sm text-(--muted-foreground) ${
        centered ? "flex w-full justify-center py-8" : "inline-flex"
      } ${className}`}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        aria-hidden="true"
        className="shrink-0 overflow-visible"
      >
        <g className="origin-center animate-[spin_1.4s_cubic-bezier(0.6,0.1,0.4,0.9)_infinite] motion-reduce:animate-pulse">
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
        </g>
        <path
          d="M60 46 H74 V60 A14 14 0 0 1 60 74 H46 V60 A14 14 0 0 1 60 46 Z"
          fill="var(--lime)"
        />
      </svg>
      <span className={showLabel ? "" : "sr-only"}>{label}</span>
    </span>
  );
}
