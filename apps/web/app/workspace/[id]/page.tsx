import Settings from "@nimbus/ui/icons/Settings";

export default function Workspace() {
  return (
    <main className="h-dvh flex">
      <section className="w-[25%] p-4 flex flex-col">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-4xl">SIH Project</h1>
          <button className="w-5 h-5">
            <Settings />
          </button>
        </div>
        <div className="text-sm text-(--muted-foreground) mb-2">
          Workspace for SIH 2025 project collaboration
        </div>
        
      </section>
      <section className="w-[75%] bg-blue-600">Editor</section>
    </main>
  );
}
