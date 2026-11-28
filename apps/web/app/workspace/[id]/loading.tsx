/**
 * @module web/app/workspace/[id]/loading
 * @description Route skeleton for the workspace room: a chat column (header,
 * description, message rows, composer) beside a document pane (tab strip and a
 * page of text lines), matching the loaded layout so nothing jumps.
 */
import { Skeleton } from "@nimbus/ui/Skeleton";

export default function Loading() {
  return (
    <main className="h-dvh flex bg-(--background) overflow-hidden">
      <section className="flex w-90 shrink-0 flex-col min-h-0 overflow-hidden border-r border-(--line-1) bg-(--panel)">
        <div className="flex items-center justify-between gap-2.5 px-4 pt-4 pb-1.5">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-7.5 rounded-lg" />
            <Skeleton className="h-6 w-32 rounded-lg" />
          </div>
          <Skeleton className="size-9 rounded-[10px]" />
        </div>
        <div className="px-4 pb-3.5">
          <Skeleton className="h-3.5 w-3/4 rounded-md" />
        </div>
        <div className="flex flex-1 min-h-0 flex-col justify-end gap-3.5 border-t border-(--line-1) px-4 py-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-2.5">
              <Skeleton className="size-8 shrink-0 rounded-[10px]" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-24 rounded-md" />
                <Skeleton className="h-4 w-full rounded-md" />
              </div>
            </div>
          ))}
        </div>
        <div className="px-3 pb-3.5 pt-6">
          <Skeleton className="h-12.5 w-full rounded-[14px]" />
        </div>
      </section>
      <section className="flex flex-1 min-w-0 min-h-0 flex-col">
        <div className="flex items-center gap-1 border-b border-(--line-1) px-4 py-2.5">
          <Skeleton className="h-8.5 w-32 rounded-[9px]" />
          <Skeleton className="h-8.5 w-36 rounded-[9px]" />
          <Skeleton className="h-8.5 w-28 rounded-[9px]" />
        </div>
        <div className="mx-auto flex w-full max-w-180 flex-col gap-4 px-10 py-12">
          <Skeleton className="h-10 w-2/3 rounded-xl" />
          <Skeleton className="h-4 w-full rounded-md" />
          <Skeleton className="h-4 w-11/12 rounded-md" />
          <Skeleton className="h-4 w-4/5 rounded-md" />
          <Skeleton className="mt-3 h-6 w-1/3 rounded-lg" />
          <Skeleton className="h-4 w-full rounded-md" />
          <Skeleton className="h-4 w-3/4 rounded-md" />
        </div>
      </section>
    </main>
  );
}
