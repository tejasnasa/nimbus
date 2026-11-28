/**
 * @module web/app/home/loading
 * @description Dashboard loading skeleton mirroring the home layout (top bar,
 * greeting, heading with filter and actions, 6-card grid with staggered
 * shimmer delays). Shown while the server component streams.
 */
import { Skeleton } from "@nimbus/ui/Skeleton";

export default function Loading() {
  return (
    <div className="min-h-dvh bg-(--background)">
      <header className="border-b border-(--line-1)">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-10">
          <Skeleton className="h-7 w-28 rounded-lg" />
          <Skeleton className="h-10 w-36 rounded-full" />
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-5 pt-16 pb-20 sm:px-10 sm:pt-24">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-3.5 w-44 rounded-md" />
            <Skeleton className="h-12 w-72 rounded-xl sm:h-16 sm:w-120" />
          </div>
          <div className="flex gap-2.5">
            <Skeleton className="h-11 w-64 rounded-xl" />
            <Skeleton className="h-11 w-32 rounded-xl" />
            <Skeleton className="h-11 w-40 rounded-xl" />
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-4.5">
          {[...Array(6)].map((_, i) => (
            <Skeleton
              key={i}
              className="h-56 rounded-[18px]"
              style={{ animationDelay: `${i * 0.1}s` }}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
