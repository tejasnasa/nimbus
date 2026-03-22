import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import Textarea from "@nimbus/ui/Textarea";

export default function Home() {
  return (
    <main className="h-dvh p-4 bg-(--background)">
      <Input placeholder="Email" />
      <Textarea placeholder="Type your message here." />
      <Button>Submit</Button>
    </main>
  );
}
