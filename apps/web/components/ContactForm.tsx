/**
 * @module web/components/ContactForm
 * @description The public contact form: category, name, email, message, and an
 * off-screen honeypot. Owns its own form state through `useContactForm`, and
 * swaps itself for a confirmation panel once the message is accepted — there is
 * no toast in this app, so the confirmation is rendered state.
 *
 * The category is a radio group of pills rather than a dropdown, driven through
 * `watch`/`setValue` because it is not a native input.
 */
"use client";
import { CONTACT_CATEGORIES, CONTACT_CATEGORY_LABELS } from "@nimbus/types";
import { Spinner } from "@nimbus/ui/icons/Spinner";
import { useContactForm, type ContactValues } from "../hooks/useContactForm";
import {
  AuthError,
  AuthField,
  authInputClass,
  authPrimaryClass,
} from "./AuthParts";

/** What to ask for, per category, as the message placeholder. */
const PLACEHOLDERS: Record<ContactValues["category"], string> = {
  bug: "What happened, and what did you expect instead?",
  feature: "What would you like Nimbus to do?",
  question: "What would you like to know?",
  other: "What’s on your mind?",
};

/**
 * @param props.prefill - Name/email seeded from the session, when there is one.
 */
export default function ContactForm({
  prefill,
}: {
  prefill?: { name?: string | null; email?: string | null };
}) {
  const {
    register,
    watch,
    setValue,
    errors,
    firstError,
    isSubmitting,
    sent,
    onSubmit,
    sendAnother,
  } = useContactForm(prefill);
  const category = watch("category");

  if (sent) {
    return (
      <div
        role="status"
        className="flex min-h-130 flex-col items-center justify-center gap-4 text-center"
      >
        <div className="lp-pop flex size-18 items-center justify-center rounded-full border-2 border-(--lime) bg-[rgba(124,207,0,0.14)]">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--lime)"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12l5 5 9-10" />
          </svg>
        </div>
        <h2 className="font-display text-[28px] font-semibold">Message sent</h2>
        <p className="max-w-85 text-[15px] leading-relaxed text-(--text-body)">
          Thanks for writing in. You&apos;ll get a reply at the address you
          gave.
        </p>
        <button
          type="button"
          onClick={sendAnother}
          className="min-h-11 cursor-pointer rounded-[11px] border border-(--line-3) px-4.5 text-sm text-(--foreground) transition-colors hover:bg-(--surface-3) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet)"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form className="relative flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <div className="flex flex-col gap-2.5">
        <span
          id="contact-category-label"
          className="text-[13px] font-medium text-(--text-soft)"
        >
          Category
        </span>
        <div
          role="radiogroup"
          aria-labelledby="contact-category-label"
          aria-invalid={errors.category ? true : undefined}
          className="flex flex-wrap gap-2"
        >
          {CONTACT_CATEGORIES.map((value) => {
            const on = category === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setValue("category", value, { shouldValidate: true })}
                className={`min-h-10 cursor-pointer rounded-full border px-4 text-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet) motion-reduce:transition-none ${
                  on
                    ? "border-(--violet) bg-[rgba(180,139,240,0.16)] text-(--foreground)"
                    : "border-(--line-3) text-(--text-body) hover:border-(--text-dim)"
                }`}
              >
                {CONTACT_CATEGORY_LABELS[value]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-50 flex-[1_1_200px]">
          <AuthField
            id="name"
            label="Name"
            placeholder="Ada Lovelace"
            {...register("name")}
          />
        </div>
        <div className="min-w-50 flex-[1_1_200px]">
          <AuthField
            id="email"
            label="Email"
            type="email"
            placeholder="ada@example.com"
            {...register("email")}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="message" className="text-[13px] font-medium text-(--text-soft)">
          Message
        </label>
        <textarea
          id="message"
          rows={7}
          placeholder={PLACEHOLDERS[category ?? "bug"]}
          className={`${authInputClass} min-h-40 resize-y py-3 leading-[1.55]`}
          {...register("message")}
        />
      </div>

      {firstError && <AuthError message={firstError} />}

      <button type="submit" disabled={isSubmitting} className={authPrimaryClass}>
        {isSubmitting && <Spinner className="h-4 w-4" />}
        Send message
        {!isSubmitting && (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 12l16-8-6 16-3-7z" />
          </svg>
        )}
      </button>

      {/*
        Off-screen rather than `hidden` or `display: none`: bots commonly skip
        fields whose computed style hides them, and this one has to stay in the
        DOM for a parser to fill it. It is `aria-hidden` and untabbable, so no
        keyboard or screen-reader user can reach it. Whether it was filled is
        decided on the server.
      */}
      <div className="absolute top-0 left-[-9999px]" aria-hidden="true">
        <label htmlFor="nimbus_hp">Leave this field empty</label>
        <input
          id="nimbus_hp"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...register("nimbus_hp")}
        />
      </div>
    </form>
  );
}
