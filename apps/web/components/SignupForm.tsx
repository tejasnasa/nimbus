import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import Link from "next/link";
import { FormHTMLAttributes } from "react";
import google from "../assets/google.svg";
import Image from "next/image";

export default function SignupForm({
  ...props
}: FormHTMLAttributes<HTMLFormElement>) {
  return (
    <section className="bg-(--card) p-6">
      <div className="flex flex-col align-middle items-center mb-8">
        <h1 className="text-2xl text-[26px] font-bold text-center m-2">
          Create your account
        </h1>
        <div className="text-xs text-(--muted-foreground)">
          Fill in the form below to create your account
        </div>
      </div>

      <form className="flex flex-col gap-4 items-center p-4 mt-4" {...props}>
        <div className="flex flex-col gap-2">
          <label htmlFor="name" className="text-sm">
            Name
          </label>
          <Input placeholder="Tejas Nasa" className="w-80" />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-sm">
            Email
          </label>
          <Input placeholder="tejas@example.com" className="w-80" />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-sm">
            Password
          </label>
          <Input placeholder="**********" type="password" className="w-80" />
        </div>
        <Button className="m-1 mt-2 font-semibold" size="sm">
          Sign Up
        </Button>
      </form>
      <div className="flex flex-col items-center justify-center gap-4">
        <hr className="border-t w-full border-(--border)" />
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
        <Link
          href="/login"
          className="text-sm text-(--muted-foreground) hover:underline transition-all"
        >
          Already have an account? Log in
        </Link>
      </div>
    </section>
  );
}
