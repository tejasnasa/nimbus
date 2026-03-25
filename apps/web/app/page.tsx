import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import Textarea from "@nimbus/ui/Textarea";
import Cloud from "@nimbus/ui/icons/Cloud";
import { authClient } from "../lib/auth-client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Home() {
  const { data: session } = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
    },
  });

  if (session) {
    redirect("/home");
  }

  return (
    <main className="h-dvh p-4 bg-(--background)">
      <Cloud />

      <Input placeholder="Email" />
      <Textarea placeholder="Type your message here." />
      <Button loading={true}>Submit</Button>
    </main>
  );
}
