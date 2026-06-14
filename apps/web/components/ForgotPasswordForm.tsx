"use client";

import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import Error from "@nimbus/ui/icons/Error";
import Login from "@nimbus/ui/icons/Login";
import { useForgotPasswordForm } from "../hooks/useForgotPasswordForm";

interface ForgotPasswordFormProps {
  openLogin: () => void;
}

export default function ForgotPasswordForm({
  openLogin,
}: ForgotPasswordFormProps) {
  const { register, firstError, isSubmitting, onSubmit, sent } =
    useForgotPasswordForm();

  return (
    <section className="glass-card rounded-2xl p-8 shadow-2xl shadow-(--primary)/5">
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-(--primary) to-(--sidebar-primary) flex items-center justify-center mb-5 shadow-lg shadow-(--primary)/20">
          <Login className="w-7 h-7 text-(--primary-foreground)" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">
          Forgot password?
        </h1>
        <p className="text-sm text-(--muted-foreground) text-center">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      {sent ? (
        <div className="flex flex-col items-center gap-4 py-2">
          <p className="text-sm text-center text-(--muted-foreground)">
            If an account exists for that email, a reset link has been sent.
            Check your inbox.
          </p>
          <button
            onClick={openLogin}
            className="text-sm text-(--primary) font-medium hover:underline hover:cursor-pointer mt-2"
          >
            Back to login
          </button>
        </div>
      ) : (
        <form className="flex flex-col gap-5" onSubmit={onSubmit}>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="forgot-email"
              className="text-sm font-medium text-(--muted-foreground)"
            >
              Email
            </label>
            <Input
              placeholder="tejas@example.com"
              className="w-full"
              id="forgot-email"
              {...register("email")}
            />
          </div>

          {firstError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20">
              <Error className="w-4 h-4 text-(--destructive) shrink-0" />
              <span className="text-xs text-(--destructive)">{firstError}</span>
            </div>
          )}

          <Button
            className="font-semibold w-full mt-1 hover:cursor-pointer"
            size="lg"
            loading={isSubmitting}
          >
            Send reset link
          </Button>

          <button
            type="button"
            onClick={openLogin}
            className="text-sm text-(--muted-foreground) hover:text-(--foreground) hover:cursor-pointer transition-colors text-center"
          >
            Back to <span className="text-(--primary) font-medium">Login</span>
          </button>
        </form>
      )}
    </section>
  );
}
