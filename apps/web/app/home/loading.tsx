import { Skeleton } from "@nimbus/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-dvh mb-10">
      <section className="m-4 mx-16 flex justify-between">
        <Skeleton className="h-12 w-36" />
        <Skeleton className="h-12 w-12 rounded-full" />
      </section>
      <h1 className="mx-28 mb-12 mt-28 text-8xl font-semibold text-(--card) animate-pulse">
        Workspaces
      </h1>

      <div className="mx-28 mb-6 flex gap-4">
        <Skeleton className="h-8 w-80 rounded-none" />
      </div>
      <section className="mx-28 flex flex-wrap gap-[1%]">
        <Skeleton className="h-60 w-[49%] mb-4" />
        <Skeleton className="h-60 w-[24%] mb-4" />
        <Skeleton className="h-60 w-[24%] mb-4" />
        <Skeleton className="h-60 w-[24%] mb-4" />
        <Skeleton className="h-60 w-[24%] mb-4" />
        <Skeleton className="h-60 w-[24%] mb-4" />
      </section>
    </main>
  );
}
