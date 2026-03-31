import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import OrContinueWith from "@nimbus/ui/OrContinueWith";
import google from "../assets/google.svg";
import Image from "next/image";
import { UseFormRegister } from "react-hook-form";
import z from "zod";
import { signupSchema } from "@nimbus/types";
import { authClient } from "../lib/auth-client";
import Signup from "@nimbus/ui/icons/Signup";
import Error from "@nimbus/ui/icons/Error";

interface SignupFormProps {
  register: UseFormRegister<z.infer<typeof signupSchema>>;
  firstError?: string;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  openLogin?: () => void;
}

export default function SignupForm({
  register,
  firstError,
  isSubmitting,
  onSubmit,
  openLogin,
}: SignupFormProps) {
  return (
    <section className="glass-card rounded-2xl p-8 shadow-2xl shadow-(--primary)/5">
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-(--chart-2) to-(--primary) flex items-center justify-center mb-5 shadow-lg shadow-(--chart-2)/20">
          <Signup className="w-7 h-7 text-(--primary-foreground)" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">
          Create your account
        </h1>
        <p className="text-sm text-(--muted-foreground)">
          Get started with Nimbus for free
        </p>
      </div>

      <form className="flex flex-col gap-5" onSubmit={onSubmit}>
        <div className="flex flex-col gap-2">
          <label
            htmlFor="name"
            className="text-sm font-medium text-(--muted-foreground)"
          >
            Name
          </label>
          <Input
            placeholder="Tejas Nasa"
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
          className="font-semibold w-full mt-1"
          size="lg"
          loading={isSubmitting}
        >
          Create Account
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
              callbackURL: `${process.env.NEXT_PUBLIC_FRONTEND_URL}/home`,
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
          onClick={openLogin}
          className="text-sm text-(--muted-foreground) hover:text-(--foreground) hover:cursor-pointer transition-colors mt-2"
        >
          Already have an account?{" "}
          <span className="text-(--primary) font-medium">Sign in</span>
        </button>
      </div>
    </section>
  );
}
