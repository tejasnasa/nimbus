import { Skeleton } from "@nimbus/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-dvh bg-(--background) relative">
      <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />

      <div className="relative z-10">
        <nav className="sticky top-0 z-40 backdrop-blur-xl bg-(--background)/70 border-b border-(--border)">
          <div className="max-w-[1400px] mx-auto px-8 h-16 flex items-center justify-between">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>
        </nav>

        <div className="max-w-[1400px] mx-auto px-8 pt-12 pb-20">
          <div className="mb-12">
            <Skeleton className="h-14 w-80 rounded-xl mb-3" />
            <Skeleton className="h-5 w-96 rounded-lg" />
          </div>

          <Skeleton className="h-10 w-72 rounded-xl mb-6" />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {[...Array(8)].map((_, i) => (
              <Skeleton
                key={i}
                className="h-56 rounded-2xl"
                style={{ animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
