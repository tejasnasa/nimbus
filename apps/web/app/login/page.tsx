import Image from "next/image";
import Cloud from "@nimbus/ui/icons/Cloud";
import signupimage from "../../assets/signup.jpg";
import Link from "next/link";
import FormSwitch from "../../components/FormSwitch";

export default async function Login() {
  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Cloud />
            </div>
            Nimbus
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <FormSwitch />
          </div>
        </div>
      </div>
      <div className="relative hidden bg-muted lg:block">
        <Image
          src={signupimage}
          width={100}
          height={100}
          alt="Image"
          className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.6] "
        />
      </div>
    </main>
  );
}
