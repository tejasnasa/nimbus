/**
 * @module ui/components/icons/CaretDown
 * @description Downward chevron used as the open/closed state cue on select
 * and dropdown triggers. Module-local so the existing icon set stays curated
 * for app-wide affordances.
 */
export default function CaretDown({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M11.9999 15.5858L6.04977 9.63672L7.46396 8.22253L11.9999 12.7575L16.5359 8.2216L17.9501 9.63579L11.9999 15.5858Z" />
    </svg>
  );
}
