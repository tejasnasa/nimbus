/**
 * @module web/components/AuthParts
 * @description Presentational building blocks shared by the sign-in, signup,
 * password-reset, email-verified and not-found screens: the top bar with the
 * logo, page heading, labelled field, primary submit button, "or" divider,
 * error banner, password strength meter, the centred status-page shell, its
 * tile illustration and the outlined secondary action.
 *
 * @important Free of hooks and event handlers on purpose, so server components
 * (the status pages) can render it. Anything interactive lives in its own
 * client module (`PasswordField`, `GoogleButton`).
 */
import Logo from "@nimbus/ui/Logo";
import ErrorIcon from "@nimbus/ui/icons/Error";
import { Spinner } from "@nimbus/ui/icons/Spinner";
import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";
import { scorePassword } from "../lib/passwordStrength";

/** Classes shared by every auth text input. */
export const authInputClass =
  "min-h-[46px] w-full rounded-[11px] border border-(--line-3) bg-(--surface-1) px-3.5 text-[15px] text-(--foreground) outline-none transition-shadow placeholder:text-(--text-dim) focus:border-(--violet) focus:ring-[3px] focus:ring-(--violet)/20";

/** Classes for the full-width primary action, usable on `button` and `Link`. */
export const authPrimaryClass =
  "inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl bg-(--brand) text-[15px] font-semibold text-white transition-colors hover:bg-(--brand)/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet) disabled:cursor-default disabled:opacity-60";

/** Right-pointing arrow used on primary actions. */
export function ArrowRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** Logo link back to the marketing home page. */
export function AuthLogoLink() {
  return (
    <Link
      href="/"
      className="w-fit text-(--foreground) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--violet)"
    >
      <Logo />
    </Link>
  );
}

/**
 * Page heading with its supporting line.
 *
 * @param props.title - The `h1` text.
 * @param props.children - Supporting copy under the heading.
 */
export function AuthHeading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <h1 className="font-display text-[40px] leading-[1.05] font-semibold tracking-[-0.03em]">
        {title}
      </h1>
      {children && (
        <p className="text-[15px] leading-[1.55] text-(--muted-foreground)">
          {children}
        </p>
      )}
    </div>
  );
}

/** Props for {@link AuthField}. */
type AuthFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Input id; also the label's `htmlFor`. */
  id: string;
  /** Visible label text. */
  label: string;
  /** Optional element shown at the label's right edge (e.g. a link). */
  labelAside?: ReactNode;
  /** Optional element overlaid at the input's right edge. */
  trailing?: ReactNode;
};

/**
 * Labelled text input. Extra props (including react-hook-form's `register`
 * spread and its `ref`) go to the `<input>`.
 */
export function AuthField({
  id,
  label,
  labelAside,
  trailing,
  className = "",
  ...input
}: AuthFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-[13px]">
        <label htmlFor={id} className="font-medium text-(--text-soft)">
          {label}
        </label>
        {labelAside}
      </div>
      <div className="relative flex">
        <input
          id={id}
          {...input}
          className={`${authInputClass} ${trailing ? "pr-12" : ""} ${className}`}
        />
        {trailing}
      </div>
    </div>
  );
}

/**
 * Primary submit button with an optional trailing arrow and a loading state.
 *
 * @param props.loading - Shows a spinner and disables the button.
 * @param props.arrow - Shows the trailing arrow icon.
 */
export function AuthSubmit({
  loading = false,
  arrow = false,
  children,
}: {
  loading?: boolean;
  arrow?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="submit" disabled={loading} className={authPrimaryClass}>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
      {arrow && !loading && <ArrowRight />}
    </button>
  );
}

/** Hairline "OR" divider between credential fields and OAuth. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3.5 font-mono text-[11px] tracking-widest text-(--text-dim)">
      <span className="h-px flex-1 bg-(--line-1)" />
      OR
      <span className="h-px flex-1 bg-(--line-1)" />
    </div>
  );
}

/** Inline form error banner. */
export function AuthError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[11px] border border-(--destructive)/20 bg-(--destructive)/10 px-3 py-2.5">
      <ErrorIcon className="h-4 w-4 shrink-0 text-(--destructive)" />
      <span className="text-xs text-(--destructive)">{message}</span>
    </div>
  );
}

const METER_COLORS = [
  "bg-(--destructive)",
  "bg-[#fdba74]",
  "bg-(--violet)",
  "bg-(--lime)",
];

/**
 * Four-segment strength meter computed from the typed password.
 *
 * @param props.password - The password as typed.
 * @param props.id - Id for the status text, so the input can reference it with `aria-describedby`.
 */
export function PasswordStrengthMeter({
  password,
  id,
}: {
  password: string;
  id?: string;
}) {
  const { score, label } = scorePassword(password);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-sm transition-colors duration-200 motion-reduce:transition-none ${
              i < score ? METER_COLORS[score - 1] : "bg-(--line-1)"
            }`}
          />
        ))}
      </div>
      <span id={id} className="text-xs text-(--muted-foreground)">
        {label}
      </span>
    </div>
  );
}

/**
 * Full-page shell for single-column status screens: top bar with the logo and
 * a vertically centred content column.
 *
 * @param props.maxWidth - Tailwind max-width class for the content column.
 * @param props.centered - Centres the text and children horizontally.
 */
export function StatusShell({
  children,
  maxWidth = "max-w-[400px]",
  centered = false,
}: {
  children: ReactNode;
  maxWidth?: string;
  centered?: boolean;
}) {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-(--background) font-sans text-(--foreground)">
      <header className="px-10 py-8">
        <AuthLogoLink />
      </header>
      <div className="flex flex-1 items-center justify-center px-10 pb-24">
        <div
          className={`flex w-full ${maxWidth} flex-col gap-7 ${centered ? "items-center text-center" : ""}`}
        >
          {children}
        </div>
      </div>
    </main>
  );
}

/** Classes for an outlined secondary action, usable on `button` and `Link`. */
export const authSecondaryClass =
  "inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--line-3) px-[22px] text-[15px] font-medium text-(--text-body) transition-colors hover:bg-(--surface-3) hover:text-(--foreground) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet)";

/**
 * The status pages' illustration: a 3×2 grid of quiet tiles with one dashed
 * tile standing out, carrying a short mark such as `?`, `404` or `!`.
 *
 * @param props.mark - Text inside the standout tile.
 * @param props.tone - `violet` for "not here", `danger` for "broke".
 */
export function StatusTiles({
  mark,
  tone = "violet",
}: {
  mark: string;
  tone?: "violet" | "danger";
}) {
  return (
    <div
      className="grid grid-cols-[repeat(3,72px)] gap-2.5"
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4, 5].map((i) =>
        i === 4 ? (
          <span
            key={i}
            className={`flex h-[52px] items-center justify-center rounded-xl border-[1.5px] border-dashed font-mono text-[15px] font-bold ${
              tone === "danger"
                ? "border-(--destructive)/50 bg-(--destructive)/5 text-red-300"
                : "border-[#4a3f55] text-(--violet)"
            }`}
          >
            {mark}
          </span>
        ) : (
          <span
            key={i}
            className="h-[52px] rounded-xl border border-(--line-1) bg-(--surface-1)"
          />
        ),
      )}
    </div>
  );
}
