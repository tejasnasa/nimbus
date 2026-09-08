/**
 * @module ui/components/Button
 * @description Primary button with size variants, optional aspect-ratio lock,
 * and a loading state that swaps in a spinner and disables interaction.
 */
import { Spinner } from "./icons/Spinner";

/** Props extending the native button attributes with Nimbus variants. */
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Visual size preset (padding + text size). Defaults to `"md"`. */
  size?: "xs" | "sm" | "md" | "lg";
  /** Optional CSS `aspect-ratio` lock; when set, horizontal padding is removed. */
  ratio?: number;
  /** When true, shows a spinner and disables the button. */
  loading?: boolean;
};

const sizes = {
  xs: "px-2.5 py-1 text-xs",
  sm: "px-4 py-2 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

const iconSizes = {
  xs: "h-2.5 w-2.5",
  sm: "h-3 w-3",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

/**
 * Primary action button.
 *
 * @param props.className - Additional Tailwind classes appended after the base styles.
 * @param props.size - Size preset controlling padding and text size.
 * @param props.ratio - Optional aspect-ratio lock for square/icon buttons.
 * @param props.loading - Shows a spinner and forces `disabled` while true.
 */
export default function Button({
  className = "",
  size = "md",
  ratio,
  style,
  loading = false,
  ...props
}: Props) {
  const base = sizes[size];

  return (
    <button
      {...props}
      style={{
        ...style,
        ...(ratio && { aspectRatio: ratio }),
      }}
      disabled={loading || props.disabled}
      className={`bg-(--primary) text-(--primary-foreground) hover:bg-(--primary)/90 rounded-xl transition-all duration-200 active:translate-y-0.5 inline-flex items-center justify-center gap-2 font-medium disabled:bg-(--primary)/40 disabled:cursor-default ${base} ${ratio ? "px-0" : ""} ${className}`}
    >
      {loading && <Spinner className={iconSizes[size]} />}
      {props.children}
    </button>
  );
}
