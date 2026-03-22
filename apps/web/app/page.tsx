import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import Textarea from "@nimbus/ui/Textarea";
import Cloud from "@nimbus/ui/icons/Cloud";

export default function Home() {
  return (
    <main className="h-dvh p-4 bg-(--background)">
      <Cloud />

      <Input placeholder="Email" />
      <Textarea placeholder="Type your message here." />
      <Button loading={true}>Submit</Button>
    </main>
  );
}
