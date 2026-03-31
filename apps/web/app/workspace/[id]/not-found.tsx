import Link from "next/link";
import Cloud from "@nimbus/ui/icons/Cloud";
import Error from "@nimbus/ui/icons/Error";

export default function NotFound() {
  return (
    <main className="min-h-dvh bg-(--background) text-(--foreground) flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-(--primary)/10 rounded-full blur-3xl animate-pulse-glow pointer-events-none" />
      <div
        className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-(--chart-2)/10 rounded-full blur-3xl animate-pulse-glow pointer-events-none"
        style={{ animationDelay: "1s" }}
      />

      <div className="z-10 flex flex-col items-center max-w-lg text-center animate-scale-in">
        <div className="mb-8 relative flex items-center justify-center">
          <div className="absolute inset-0 bg-(--primary)/20 blur-2xl rounded-full animate-pulse-glow" />
          <div className="w-28 h-28 rounded-3xl bg-(--card)/60 border border-(--border) backdrop-blur-xl flex items-center justify-center shadow-2xl relative z-10 animate-float">
            <Error className="w-12 h-12 text-(--primary)" />
          </div>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
          Workspace Not Found
        </h1>
        <p className="text-(--muted-foreground) text-lg mb-10 leading-relaxed">
          The workspace you&apos;re looking for doesn&apos;t exist, has been
          deleted, or you don&apos;t have permission to view it.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
          <Link
            href="/home"
            className="w-full sm:w-auto px-8 py-3.5 text-sm font-medium rounded-xl bg-(--primary) text-(--primary-foreground) hover:opacity-90 active:translate-y-0.5 transition-all duration-200 shadow-lg shadow-(--primary)/25"
          >
            Return Home
          </Link>
        </div>
      </div>

      <div className="absolute bottom-8 left-0 right-0 flex justify-center opacity-40">
        <div className="flex items-center gap-2 text-sm text-(--muted-foreground)">
          <Cloud />
          <span className="tracking-tight font-medium">Nimbus</span>
        </div>
      </div>
    </main>
  );
}
