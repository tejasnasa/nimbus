/**
 * @module ui/components/Select
 * @description Custom combobox/listbox replacing the native `<select>` so the
 * popup honors the app's tokens. The list a native `<select>` opens is drawn
 * by the operating system, not the page, and cannot be reached from CSS at
 * all -- not by a `bg-*` class, and not by `color-scheme` on the document,
 * which the platform is free to ignore. On a dark-only interface that means
 * a light popup no amount of styling fixes. Drawing the panel ourselves is
 * the only path that matches the surrounding form.
 *
 * The cost of leaving the native element behind is that its behaviour has to
 * be rebuilt. This is a `combobox`/`listbox` pair rather than a menu: the
 * trigger keeps focus while the list is open, arrow keys move a highlight
 * through it, Enter takes the highlighted choice, and Escape closes without
 * choosing. `aria-activedescendant` -- not focus -- is what tells assistive
 * technology which row is highlighted, which is the pattern a select-only
 * combobox is specified to use.
 *
 * @important The panel's open animation references the `scale-in` keyframe
 *            defined in the host app's globals.css. Consumers that do not
 *            import the keyframe will render the panel without the fade/scale
 *            -- still functional, just unanimated.
 */
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import CaretDown from "./icons/CaretDown";
import Check from "./icons/Check";

/** One choice in the list. */
export type SelectOption = {
  value: string;
  label: string;
  /** Visually disabled; clicks and arrow-keys skip it. */
  disabled?: boolean;
};

type Props = {
  /** Field id. Used for the trigger, the label, and the listbox wiring. */
  id: string;
  /** Field label, rendered above the control. */
  label: string;
  /** Currently selected value, or `""` for none. */
  value: string;
  /** Called with the newly chosen value. */
  onChange: (value: string) => void;
  /** The choices, in display order. */
  options: readonly SelectOption[];
  /** Shown on the trigger while nothing is selected. */
  placeholder?: string;
  /** Form field name; passed through so RHF / native form submission work. */
  name?: string;
  /** Marks the field as failing validation. Reddens the trigger border. */
  invalid?: boolean;
  /** Disables interaction; greys out the trigger. */
  disabled?: boolean;
  /** Extra classes appended to the outer wrapper. */
  className?: string;
  /** Extra classes appended to the trigger button. */
  triggerClassName?: string;
};

/**
 * Select rendered as a button that opens a listbox.
 *
 * @param props.id - Field id. Used for the trigger and ARIA wiring.
 * @param props.label - Field label, rendered above the control.
 * @param props.value - Currently selected value, or `""` for none.
 * @param props.onChange - Called with the newly chosen value.
 * @param props.options - The choices, in display order.
 * @param props.placeholder - Shown on the trigger while nothing is selected.
 * @param props.name - Form field name; forwarded to the hidden input.
 * @param props.invalid - Marks the field as failing validation.
 * @param props.disabled - Disables interaction.
 * @param props.className - Extra classes for the outer wrapper.
 * @param props.triggerClassName - Extra classes for the trigger button.
 */
export default function Select({
  id,
  label,
  value,
  onChange,
  options,
  placeholder = "Select an option",
  name,
  invalid = false,
  disabled = false,
  className = "",
  triggerClassName = "",
}: Props) {
  const [open, setOpen] = useState(false);
  // Index into `options` of the row that has keyboard focus right now. `-1`
  // when the list is closed or nothing is highlighted. Skips disabled rows so
  // they never get committed.
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const labelId = `${id}-label`;
  const listboxId = `${id}-listbox`;
  const optionId = (index: number) => `${id}-option-${index}`;

  const selected = options.find((option) => option.value === value);

  /**
   * Picks the next highlight, skipping `disabled` rows so a user can never
   * arrow-key onto something they cannot choose.
   */
  const moveActive = useCallback(
    (from: number, direction: 1 | -1): number => {
      if (options.length === 0) return -1;
      let next = from;
      for (let i = 0; i < options.length; i += 1) {
        next = (next + direction + options.length) % options.length;
        if (!options[next]!.disabled) return next;
      }
      // Every option is disabled -- nothing to land on.
      return -1;
    },
    [options],
  );

  /** Opens the list with the current selection highlighted. */
  const openList = useCallback(() => {
    const currentIndex = options.findIndex((option) => option.value === value);
    setActiveIndex(
      currentIndex >= 0 && !options[currentIndex]!.disabled
        ? currentIndex
        : moveActive(-1, 1),
    );
    setOpen(true);
  }, [options, value, moveActive]);

  /** Takes a choice and closes. No-op when disabled. */
  const choose = (next: string, optionDisabled?: boolean) => {
    if (optionDisabled) return;
    onChange(next);
    setOpen(false);
    // Move focus back to the trigger so a subsequent Tab continues through
    // the form rather than the listbox.
    triggerRef.current?.focus();
  };

  // Dismiss on a click anywhere outside. `mousedown` rather than `click` so
  // the panel closes as the press lands, before the click it belongs to
  // resolves on another element.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      // Enter and Space are left to the button's own click, which already
      // toggles.
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openList();
      }
      return;
    }

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        // Moving on rather than choosing: a Tab out of an open list should not
        // commit the highlighted row, which the user may never have looked
        // at.
        setOpen(false);
        break;
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => moveActive(index, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => moveActive(index, -1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(moveActive(-1, 1));
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(moveActive(options.length, -1));
        break;
      case "Enter":
      case " ":
        // `preventDefault` so the button's own click does not also fire and
        // toggle the list shut instead of choosing.
        event.preventDefault();
        if (activeIndex >= 0) {
          const option = options[activeIndex]!;
          choose(option.value, option.disabled);
        }
        break;
    }
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`} ref={wrapperRef}>
      <span id={labelId} className="text-xs font-medium">
        {label}
      </span>

      <div className="relative">
        <button
          type="button"
          ref={triggerRef}
          id={id}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-labelledby={`${labelId} ${id}`}
          aria-activedescendant={
            open && activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          aria-invalid={invalid || undefined}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            if (open) {
              setOpen(false);
            } else {
              openList();
            }
          }}
          onKeyDown={handleKeyDown}
          data-testid={id}
          className={`w-full h-11 rounded-xl pl-4 pr-10 text-sm text-left border bg-(--muted)/50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:border-(--primary)/30 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${invalid ? "border-(--destructive)/60" : "border-(--border)"} ${triggerClassName}`}
        >
          <span
            className={
              selected ? "text-(--foreground)" : "text-(--muted-foreground)/50"
            }
          >
            {selected?.label ?? placeholder}
          </span>
        </button>

        <CaretDown
          className={`pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-(--muted-foreground) transition-transform duration-200 w-4 h-4 ${open ? "rotate-180" : ""}`}
        />

        {/*
          Hidden form input so native form submission still carries the
          value. RHF reads from this name via `register({ name })` if a
          caller wires that way; otherwise the parent uses `value`/`onChange`
          alone and the field is purely a combobox.
        */}
        {name && <input type="hidden" name={name} value={value} />}

        {open && (
          <ul
            role="listbox"
            id={listboxId}
            aria-labelledby={labelId}
            className="absolute z-50 left-0 right-0 mt-1 rounded-xl border border-(--border) bg-(--card) shadow-xl shadow-(--primary)/5 p-1.5 backdrop-blur-xl"
            style={{ animation: "scale-in 0.15s ease-out" }}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <li
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  onClick={() => choose(option.value, option.disabled)}
                  className={`flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer transition-all duration-150 text-(--foreground) ${isActive ? "bg-(--primary)/15 text-(--primary)" : "hover:bg-(--muted)/60"} ${option.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {isSelected && (
                    <Check
                      className={`shrink-0 w-3.5 h-3.5 ${isActive ? "text-(--primary)" : "text-(--muted-foreground)"}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
