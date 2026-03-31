import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import OrContinueWith from "@nimbus/ui/OrContinueWith";
import Image from "next/image";
import google from "../assets/google.svg";
import { UseFormRegister } from "react-hook-form";
import z from "zod";
import { loginSchema } from "@nimbus/types";
import { authClient } from "../lib/auth-client";
import Login from "@nimbus/ui/icons/Login";
import Error from "@nimbus/ui/icons/Error";

interface LoginFormProps {
  register: UseFormRegister<z.infer<typeof loginSchema>>;
  firstError?: string;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  openSignup?: () => void;
}

export default function LoginForm({
  register,
  firstError,
  isSubmitting,
  onSubmit,
  openSignup,
}: LoginFormProps) {
  return (
    <section className="glass-card rounded-2xl p-8 shadow-2xl shadow-(--primary)/5">
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-(--primary) to-(--sidebar-primary) flex items-center justify-center mb-5 shadow-lg shadow-(--primary)/20">
          <Login className="w-7 h-7 text-(--primary-foreground)" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">Welcome back</h1>
        <p className="text-sm text-(--muted-foreground)">
          Log in to continue to your workspaces
        </p>
      </div>

      <form className="flex flex-col gap-5" onSubmit={onSubmit}>
        <div className="flex flex-col gap-2">
          <label
            htmlFor="email"
            className="text-sm font-medium text-(--muted-foreground)"
          >
            Email
          </label>
          <Input
            placeholder="tejas@example.com"
            className="w-full"
            id="email"
            {...register("email")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label
            htmlFor="password"
            className="text-sm font-medium text-(--muted-foreground)"
          >
            Password
          </label>
          <Input
            placeholder="••••••••"
            type="password"
            className="w-full"
            id="password"
            {...register("password")}
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
          Login
        </Button>
      </form>

      <div className="flex flex-col items-center gap-4 mt-4">
        <OrContinueWith />
        <Button
          size="sm"
          className="bg-white text-black transition-colors hover:bg-gray-200 w-full border border-(--border) cursor-pointer"
          onClick={async () => {
            await authClient.signIn.social({
              provider: "google",
              callbackURL: "/home",
            });
          }}
        >
          <Image
            src={google}
            alt="Google"
            width={18}
            height={18}
            className="inline"
          />
          Continue with Google
        </Button>
        <button
          onClick={openSignup}
          className="text-sm text-(--muted-foreground) hover:text-(--foreground) hover:cursor-pointer transition-colors mt-2"
        >
          Don&apos;t have an account?{" "}
          <span className="text-(--primary) font-medium">Sign up</span>
        </button>
      </div>
    </section>
  );
}
