import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import OrContinueWith from "@nimbus/ui/OrContinueWith";
import google from "../assets/google.svg";
import Image from "next/image";
import { UseFormRegister } from "react-hook-form";
import z from "zod";
import { signupSchema } from "@nimbus/types";

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
    <section className="bg-(--card) p-6 rounded-xl">
      <div className="flex flex-col align-middle items-center mb-6">
        <h1 className="text-2xl text-[26px] font-bold text-center m-2">
          Create your account
        </h1>
        <div className="text-xs text-(--muted-foreground)">
          Fill in the form below to create your account
        </div>
      </div>

      <form
        className="flex flex-col gap-4 items-center p-2 mt-4"
        onSubmit={onSubmit}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="name" className="text-sm">
            Name
          </label>
          <Input
            placeholder="Tejas Nasa"
            className="w-80"
            id="name"
            {...register("name")}
          />
        </div>
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
          className="m-4 mt-0 font-semibold w-full"
          size="sm"
          loading={isSubmitting}
        >
          Sign Up
        </Button>
      </form>
      <div className="flex flex-col items-center justify-center gap-4">
        <OrContinueWith />
        <Button size="sm" className="bg-white text-black hover:bg-gray-200">
          Sign up with
          <Image
            src={google}
            alt="Google"
            width={20}
            height={20}
            className="inline ml-0.5"
          />
        </Button>
        <button
          onClick={openLogin}
          className="text-sm text-(--muted-foreground) hover:underline hover:cursor-pointer transition-all"
        >
          Already have an account? Log in
        </button>
      </div>
    </section>
  );
}
