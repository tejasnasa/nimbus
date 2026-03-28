import { Skeleton } from "@nimbus/ui/Skeleton";

export default function Loading() {
  return (
    <main className="h-dvh flex">
      <section className="w-[25%] p-4 flex flex-col min-h-0 overflow-hidden border-r border-(--border)">
        <div className="flex justify-between items-center mb-2">
          <Skeleton className="h-10 w-[70%]" />
          <Skeleton className="h-10 w-[15%]" />
        </div>
        <div className="text-sm text-(--muted-foreground) mb-2">
          <Skeleton className="h-8 w-full" />
        </div>
        <Skeleton className="h-full w-full" />
      </section>
      <section className="w-[75%] p-4 flex flex-col min-h-0 overflow-hidden">
        <Skeleton className="h-full w-full" />
      </section>
    </main>
  );
}
