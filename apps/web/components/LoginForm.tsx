import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import OrContinueWith from "@nimbus/ui/OrContinueWith";
import Image from "next/image";
import google from "../assets/google.svg";
import { UseFormRegister } from "react-hook-form";
import z from "zod";
import { loginSchema } from "@nimbus/types";
import { authClient } from "../lib/auth-client";

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
    <section className="bg-(--card) p-6 rounded-xl">
      <div className="flex flex-col align-middle items-center mb-6">
        <h1 className="text-2xl text-[25px] font-bold text-center m-2">
          Login to your account
        </h1>
        <div className="text-xs text-(--muted-foreground)">
          Enter your email to login to your account
        </div>
      </div>

      <form
        className="flex flex-col gap-4 items-center p-2 mt-4"
        onSubmit={onSubmit}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-sm">
            Email
          </label>
          <Input
            placeholder="tejas@example.com"
            className="w-80"
            id="email"
            {...register("email")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-sm">
            Password
          </label>
          <Input
            placeholder="**********"
            type="password"
            className="w-80"
            id="password"
            {...register("password")}
          />
        </div>
        {firstError && (
          <span className="text-xs text-red-500 self-start ml-0.5">
            {firstError}
          </span>
        )}
        <Button
          className="font-semibold w-full m-3"
          size="sm"
          loading={isSubmitting}
        >
          Login
        </Button>
      </form>
      <div className="flex flex-col items-center justify-center gap-4">
        <OrContinueWith />
        <Button
          size="sm"
          className="bg-white text-black hover:bg-gray-200"
          onClick={async () => {
            await authClient.signIn.social({
              provider: "google",
              callbackURL: "/home",
            });
          }}
        >
          Login with
          <Image
            src={google}
            alt="Google"
            width={20}
            height={20}
            className="inline ml-0.5"
          />
        </Button>
        <button
          onClick={openSignup}
          className="text-sm text-(--muted-foreground) hover:underline hover:cursor-pointer transition-all"
        >
          Don&apos;t have an account? Sign up
        </button>
      </div>
    </section>
  );
}
