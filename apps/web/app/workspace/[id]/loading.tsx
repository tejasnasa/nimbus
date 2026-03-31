import { Skeleton } from "@nimbus/ui/Skeleton";

export default function Loading() {
  return (
    <main className="h-dvh flex bg-(--background) overflow-hidden">
      <section className="w-[320px] min-w-[320px] flex flex-col min-h-0 overflow-hidden border-r border-(--border) bg-(--card)/20">
        <div className="flex justify-between items-center p-4 pb-2">
          <Skeleton className="h-8 w-[70%] rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
        <div className="px-4 pb-3">
          <Skeleton className="h-4 w-full rounded-md mb-1" />
          <Skeleton className="h-4 w-2/3 rounded-md" />
        </div>
        <div className="flex-1 min-h-0 px-2 pb-2">
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
      </section>
      <section className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="border-b border-(--border) p-2">
          <div className="flex gap-3">
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-28 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </div>
        <div className="flex-1 min-h-0 p-4">
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
      </section>
    </main>
  );
}
