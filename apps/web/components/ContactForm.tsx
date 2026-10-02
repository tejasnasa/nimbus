/**
 * @module web/components/ContactForm
 * @description The public contact form: category, name, email, message, and an
 * off-screen honeypot. Owns its own form state through `useContactForm`, and
 * swaps itself for a confirmation panel once the message is accepted — there is
 * no toast in this app, so the confirmation is rendered state.
 */
"use client";
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
} from "@nimbus/types";
import Button from "@nimbus/ui/Button";
import Chat from "@nimbus/ui/icons/Chat";
import Error from "@nimbus/ui/icons/Error";
import Input from "@nimbus/ui/Input";
import Select from "@nimbus/ui/Select";
import Textarea from "@nimbus/ui/Textarea";
import {
  useContactForm,
  type ContactValues,
} from "../hooks/useContactForm";

/** The dropdown's options, labelled from the same map the mail subject uses. */
const CATEGORY_OPTIONS = CONTACT_CATEGORIES.map((category) => ({
  value: category,
  label: CONTACT_CATEGORY_LABELS[category],
}));

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

  if (sent) {
    return (
      <section className="glass-card rounded-2xl p-8 shadow-2xl shadow-(--primary)/5">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-(--chart-2) to-(--primary) flex items-center justify-center shadow-lg shadow-(--chart-2)/20">
            <Chat className="w-7 h-7 text-(--primary-foreground)" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Message sent</h2>
          <p className="text-sm text-(--muted-foreground)">
            Thanks — it is in the inbox now. A reply will go back to the address
            you gave.
          </p>
          <Button
            className="font-semibold w-full mt-2"
            size="lg"
            onClick={sendAnother}
          >
            Send another message
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="glass-card rounded-2xl p-8 shadow-2xl shadow-(--primary)/5 relative">
      <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
        <Select
          id="category"
          label="Category"
          value={watch("category") ?? ""}
          onChange={(value) =>
            setValue("category", value as ContactValues["category"])
          }
          options={CATEGORY_OPTIONS}
          placeholder="Choose a category"
          invalid={Boolean(errors.category)}
        />

        <div className="flex flex-col gap-2">
          <label
            htmlFor="name"
            className="text-sm font-medium text-(--muted-foreground)"
          >
            Name
          </label>
          <Input
            placeholder="Ada Lovelace"
            className="w-full"
            id="name"
            {...register("name")}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="email"
            className="text-sm font-medium text-(--muted-foreground)"
          >
            Email
          </label>
          <Input
            placeholder="ada@example.com"
            className="w-full"
            id="email"
            {...register("email")}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="message"
            className="text-sm font-medium text-(--muted-foreground)"
          >
            Message
          </label>
          <Textarea
            placeholder="What happened, and what did you expect instead?"
            className="w-full"
            id="message"
            size="lg"
            {...register("message")}
          />
        </div>

        {firstError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20">
            <Error className="w-4 h-4 text-(--destructive) shrink-0" />
            <span className="text-xs text-(--destructive)">{firstError}</span>
          </div>
        )}

        <Button
          className="font-semibold w-full mt-1"
          size="lg"
          loading={isSubmitting}
        >
          Send message
        </Button>

        {/*
          Off-screen rather than `hidden` or `display: none`: bots commonly skip
          fields whose computed style hides them, and this one has to stay in the
          DOM for a parser to fill it. It is `aria-hidden` and untabbable, so no
          keyboard or screen-reader user can reach it. Whether it was filled is
          decided on the server.
        */}
        <div
          className="absolute left-[-9999px] top-0"
          aria-hidden="true"
        >
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
    </section>
  );
}
