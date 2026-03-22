import Navbar from "@nimbus/ui/Navbar";
import ToggleGroup from "@nimbus/ui/ToggleGroup";

export default function Home() {
  return (
    <main className="h-dvh">
      <Navbar />
      <h1 className="mx-28 my-8 text-8xl font-semibold">Workspaces</h1>
      <ToggleGroup options={["All Workspaces", "My Workspaces"]} />
    </main>
  );
}
