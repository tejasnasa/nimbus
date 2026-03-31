import Link from "next/link";
import Cloud from "@nimbus/ui/icons/Cloud";

export default function NotFound() {
  return (
    <main className="min-h-dvh bg-(--background) text-(--foreground) flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-(--primary)/10 rounded-full blur-3xl pointer-events-none" />
      <div
        className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-(--chart-2)/10 rounded-full blur-3xl pointer-events-none"
        style={{ animationDelay: "1s" }}
      />

      <div className="z-10 flex flex-col items-center max-w-md text-center">
        <div className="mb-8 relative flex items-center justify-center">
          <div className="absolute inset-0 bg-(--primary)/20 blur-2xl rounded-full" />
          <div className="w-24 h-24 rounded-3xl bg-(--card)/60 border border-(--border) backdrop-blur-xl flex items-center justify-center shadow-2xl relative z-10">
            <svg
              className="w-12 h-12 text-(--muted-foreground)"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
        </div>

        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 text-transparent bg-clip-text bg-linear-to-r from-(--foreground) to-(--muted-foreground)">
          Workspace Not Found
        </h1>
        <p className="text-(--muted-foreground) text-lg mb-10 leading-relaxed">
          The workspace you're looking for doesn't exist, has been deleted, or
          you don't have permission to view it.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
          <Link
            href="/home"
            className="w-full sm:w-auto px-6 py-3 text-sm font-medium rounded-xl bg-(--primary) text-(--primary-foreground) hover:opacity-90 active:translate-y-0.5 transition-all duration-200 shadow-lg shadow-(--primary)/25"
          >
            Return Home
          </Link>
        </div>
      </div>

      <div className="absolute bottom-8 left-0 right-0 flex justify-center opacity-50">
        <div className="flex items-center gap-2 text-sm text-(--muted-foreground)">
          <Cloud />
          <span>Nimbus</span>
        </div>
      </div>
    </main>
  );
}
