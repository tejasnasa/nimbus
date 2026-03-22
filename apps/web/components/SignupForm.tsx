import Input from "@nimbus/ui/Input";

export default function SignupForm() {
  return (
    <form className="flex flex-col gap-4 p-8 items-center">
      <Input placeholder="Name" />
      <Input placeholder="Email" />
      <Input placeholder="Password" type="password" />
    </form>
  );
}
