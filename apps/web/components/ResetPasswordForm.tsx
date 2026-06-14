"use client";

import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import Error from "@nimbus/ui/icons/Error";
import Lock from "@nimbus/ui/icons/Lock";
import { useResetPasswordForm } from "../hooks/useResetPasswordForm";
import { Spinner } from "@nimbus/ui/icons/Spinner";

export default function ResetPasswordForm({ token }: { token: string }) {
  const { register, firstError, isSubmitting, onSubmit, done } =
    useResetPasswordForm(token);

  return (
    <section className="glass-card rounded-2xl p-8 shadow-2xl shadow-(--primary)/5">
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-(--primary) to-(--sidebar-primary) flex items-center justify-center mb-5 shadow-lg shadow-(--primary)/20">
          <Lock className="w-7 h-7 text-(--primary-foreground)" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">
          Set new password
        </h1>
        <p className="text-sm text-(--muted-foreground) text-center">
          Choose a strong password for your account.
        </p>
      </div>

      {done ? (
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20">
            <Spinner className="w-7 h-7 text-(--primary-foreground)" />
          </div>
          <p className="text-sm text-center text-(--muted-foreground)">
            Password updated! Redirecting you to login&hellip;
          </p>
        </div>
      ) : (
        <form className="flex flex-col gap-5" onSubmit={onSubmit}>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="new-password"
              className="text-sm font-medium text-(--muted-foreground)"
            >
              New Password
            </label>
            <Input
              placeholder="••••••••"
              type="password"
              className="w-full"
              id="new-password"
              {...register("password")}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="confirm-password"
              className="text-sm font-medium text-(--muted-foreground)"
            >
              Confirm Password
            </label>
            <Input
              placeholder="••••••••"
              type="password"
              className="w-full"
              id="confirm-password"
              {...register("confirmPassword")}
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
            Reset password
          </Button>
        </form>
      )}
    </section>
  );
}
