import Cloud from "@nimbus/ui/icons/Cloud";
import Link from "next/link";
import FormSwitch from "../../components/FormSwitch";

export default async function Login() {
  return (
    <main className="h-dvh bg-(--background) text-(--foreground) relative overflow-hidden">
      <div className="absolute inset-0 bg-grid opacity-40 pointer-events-none" />
      <div className="absolute top-1/4 -left-32 w-125 h-125 bg-(--primary)/15 rounded-full blur-3xl animate-pulse-glow pointer-events-none" />
      <div
        className="absolute bottom-1/4 -right-32 w-100 h-100 bg-(--sidebar-primary)/10 rounded-full blur-3xl animate-pulse-glow pointer-events-none"
        style={{ animationDelay: "1s" }}
      />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-150 h-150 bg-(--chart-2)/5 rounded-full blur-3xl pointer-events-none" />

      <nav className="relative z-10 px-8 py-5">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold text-lg group w-fit"
        >
          <div className="flex size-9 items-center justify-center rounded-lg text-(--primary-foreground) group-hover:scale-110 transition-transform duration-300">
            <Cloud />
          </div>
          <span className="tracking-tight">Nimbus</span>
        </Link>
      </nav>

      <div className="relative z-10 flex items-center justify-center min-h-[calc(100dvh-80px)] px-6">
        <div className="w-full max-w-md animate-scale-in">
          <FormSwitch />
        </div>
      </div>
    </main>
  );
}
