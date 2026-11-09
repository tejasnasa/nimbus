/**
 * @module web/components/Pagination
 * @description Previous / page number / Next control for the settings tables.
 * Renders nothing when there is only one page, so a short list carries no
 * paging chrome.
 */
"use client";

/**
 * @param props.page - One-based number of the page on screen.
 * @param props.hasPrevious - Whether an earlier page exists.
 * @param props.hasNext - Whether a later page exists.
 * @param props.disabled - Holds both buttons, e.g. while a page loads.
 * @param props.onPrevious - Goes back one page.
 * @param props.onNext - Goes forward one page.
 * @param props.testId - Prefix for the control's test ids.
 */
export default function Pagination({
  page,
  hasPrevious,
  hasNext,
  disabled = false,
  onPrevious,
  onNext,
  testId = "pagination",
}: {
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  testId?: string;
}) {
  if (!hasPrevious && !hasNext) return null;

  const buttonClass =
    "rounded-lg border border-(--border) px-3 py-1 text-xs font-medium hover:cursor-pointer hover:bg-(--muted) disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3"
      data-testid={testId}
    >
      <button
        type="button"
        className={buttonClass}
        disabled={disabled || !hasPrevious}
        onClick={onPrevious}
        data-testid={`${testId}-previous`}
      >
        Previous
      </button>
      <span
        className="text-xs text-(--muted-foreground)"
        data-testid={`${testId}-page`}
      >
        Page {page}
      </span>
      <button
        type="button"
        className={buttonClass}
        disabled={disabled || !hasNext}
        onClick={onNext}
        data-testid={`${testId}-next`}
      >
        Next
      </button>
    </nav>
  );
}
