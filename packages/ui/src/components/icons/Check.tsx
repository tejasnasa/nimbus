/**
 * @module ui/components/icons/Check
 * @description Filled checkmark for "selected" indicators inside listboxes
 * and option rows. Module-local so the existing icon set stays curated for
 * app-wide affordances.
 */
export default function Check({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M9 16.2L4.8 12L3.4 13.4L9 19L21 7L19.6 5.6L9 16.2Z" />
    </svg>
  );
}
