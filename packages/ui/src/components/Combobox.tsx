/**
 * @module ui/components/Combobox
 * @description Searchable listbox on the same tokens and keyboard model as
 * {@link Select}. Where `Select` is a button that opens a list, this is a text
 * input that filters one: type to narrow, arrow keys move a highlight, Enter
 * takes it, Escape closes without choosing.
 *
 * The input keeps focus the whole time. `aria-activedescendant` -- not focus --
 * tells assistive technology which row is highlighted, which is the pattern an
 * editable combobox is specified to use.
 *
 * Rows are plain data. A caller that needs richer rows (chips, prices) passes
 * `renderOption`; the label and `description` are what the filter searches. An
 * optional trailing action row (`footerAction`) is always visible, regardless of
 * the filter, so an escape hatch such as "Use a custom id" is never searched away.
 *
 * @important The panel's open animation references the `scale-in` keyframe
 *            defined in the host app's globals.css, as `Select` does.
 */
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import CaretDown from "./icons/CaretDown";
import Check from "./icons/Check";

/** One choice in the list. */
export type ComboboxOption = {
  value: string;
  label: string;
  /** Secondary text, searched along with the label (for example a model id). */
  description?: string;
  /** Visually disabled; clicks and arrow keys skip it. */
  disabled?: boolean;
};

/** The always-visible last row, for an action rather than a choice. */
export type ComboboxFooterAction = {
  label: string;
  onSelect: () => void;
};

type Props = {
  /** Field id. Used for the input, the label and the listbox wiring. */
  id: string;
  /** Field label, rendered above the control. */
  label: string;
  /** Currently selected value, or `""` for none. */
  value: string;
  /** Called with the newly chosen value. */
  onChange: (value: string) => void;
  /** The choices, in display order. */
  options: readonly ComboboxOption[];
  /** Shown in the input while nothing is selected. */
  placeholder?: string;
  /** Shown instead of the list when the filter matches nothing. */
  emptyText?: string;
  /** Trailing action row, shown whatever the filter says. */
  footerAction?: ComboboxFooterAction;
  /** Renders a row's content; defaults to the label and description. */
  renderOption?: (option: ComboboxOption) => React.ReactNode;
  /** Marks the field as failing validation. */
  invalid?: boolean;
  /** Disables interaction. */
  disabled?: boolean;
  /** Extra classes appended to the outer wrapper. */
  className?: string;
};

/** Case-insensitive substring match over the label and description. */
const matches = (option: ComboboxOption, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return (
    option.label.toLowerCase().includes(needle) ||
    (option.description?.toLowerCase().includes(needle) ?? false)
  );
};

/**
 * Searchable combobox.
 *
 * @param props.id - Field id.
 * @param props.label - Field label.
 * @param props.value - Selected value, or `""`.
 * @param props.onChange - Called with the chosen value.
 * @param props.options - The choices.
 * @param props.placeholder - Input placeholder while nothing is selected.
 * @param props.emptyText - Message when the filter matches nothing.
 * @param props.footerAction - Always-visible trailing action row.
 * @param props.renderOption - Custom row content.
 * @param props.invalid - Marks the field invalid.
 * @param props.disabled - Disables interaction.
 * @param props.className - Extra wrapper classes.
 */
export default function Combobox({
  id,
  label,
  value,
  onChange,
  options,
  placeholder = "Search",
  emptyText = "No matches",
  footerAction,
  renderOption,
  invalid = false,
  disabled = false,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Index into the *visible* rows (filtered options, then the footer action).
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const labelId = `${id}-label`;
  const listboxId = `${id}-listbox`;
  const optionId = (index: number) => `${id}-option-${index}`;

  const selected = options.find((option) => option.value === value);
  const visible = useMemo(
    () => options.filter((option) => matches(option, query)),
    [options, query],
  );

  // The footer action is addressed as one more row after the filtered options.
  const rowCount = visible.length + (footerAction ? 1 : 0);
  const isFooter = (index: number) => footerAction && index === visible.length;

  /** Next enabled row in `direction`, wrapping; `-1` when nothing is enabled. */
  const move = (from: number, direction: 1 | -1): number => {
    if (rowCount === 0) return -1;
    let next = from;
    for (let i = 0; i < rowCount; i += 1) {
      next = (next + direction + rowCount) % rowCount;
      if (isFooter(next) || !visible[next]!.disabled) return next;
    }
    return -1;
  };

  const close = () => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  };

  const openList = () => {
    const current = visible.findIndex((option) => option.value === value);
    setActiveIndex(current >= 0 ? current : move(-1, 1));
    setOpen(true);
  };

  const choose = (index: number) => {
    if (isFooter(index)) {
      footerAction!.onSelect();
      close();
      return;
    }
    const option = visible[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
  };

  // Dismiss on a press anywhere outside, as `Select` does.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setQuery("");
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openList();
      }
      return;
    }

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        // Moving on is not choosing.
        close();
        break;
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => move(index, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => move(index, -1));
        break;
      case "Enter":
        event.preventDefault();
        if (activeIndex >= 0) choose(activeIndex);
        break;
    }
  }

  const activeDescendant =
    open && activeIndex >= 0 && activeIndex < rowCount
      ? optionId(activeIndex)
      : undefined;

  return (
    <div className={`flex flex-col gap-1 ${className}`} ref={wrapperRef}>
      <label id={labelId} htmlFor={id} className="text-xs font-medium">
        {label}
      </label>

      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          data-testid={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          placeholder={selected ? selected.label : placeholder}
          value={open ? query : (selected?.label ?? "")}
          onFocus={openList}
          onClick={() => {
            if (!open) openList();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) setOpen(true);
            // The highlight follows the first enabled match as the list narrows.
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          className={`w-full h-11 rounded-xl pl-4 pr-10 text-sm text-left border bg-(--muted)/50 text-(--foreground) placeholder:text-(--muted-foreground)/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:border-(--primary)/30 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${invalid ? "border-(--destructive)/60" : "border-(--border)"}`}
        />

        <CaretDown
          className={`pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-(--muted-foreground) transition-transform duration-200 w-4 h-4 ${open ? "rotate-180" : ""}`}
        />

        {open && (
          <ul
            role="listbox"
            id={listboxId}
            aria-labelledby={labelId}
            className="absolute z-50 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-xl border border-(--border) bg-(--card) shadow-xl shadow-(--primary)/5 p-1.5 backdrop-blur-xl"
            style={{ animation: "scale-in 0.15s ease-out" }}
          >
            {visible.length === 0 && (
              <li
                role="presentation"
                data-testid={`${id}-empty`}
                className="px-3 py-2 text-sm text-(--muted-foreground)"
              >
                {emptyText}
              </li>
            )}

            {visible.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <li
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  // `mousedown` rather than `click`, so the input never loses
                  // focus (and closes the list) before the choice lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  onClick={() => choose(index)}
                  className={`flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer transition-all duration-150 text-(--foreground) ${isActive ? "bg-(--primary)/15 text-(--primary)" : "hover:bg-(--muted)/60"} ${option.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    {renderOption ? (
                      renderOption(option)
                    ) : (
                      <>
                        <span className="block truncate">{option.label}</span>
                        {option.description && (
                          <span className="block truncate text-xs text-(--muted-foreground)">
                            {option.description}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                  {isSelected && (
                    <Check
                      className={`shrink-0 w-3.5 h-3.5 ${isActive ? "text-(--primary)" : "text-(--muted-foreground)"}`}
                    />
                  )}
                </li>
              );
            })}

            {footerAction && (
              <li
                id={optionId(visible.length)}
                role="option"
                aria-selected={false}
                data-testid={`${id}-footer`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(visible.length)}
                onClick={() => choose(visible.length)}
                className={`mt-1 border-t border-(--border) rounded-lg px-3 py-2 text-sm cursor-pointer text-(--foreground) ${activeIndex === visible.length ? "bg-(--primary)/15 text-(--primary)" : "hover:bg-(--muted)/60"}`}
              >
                {footerAction.label}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
