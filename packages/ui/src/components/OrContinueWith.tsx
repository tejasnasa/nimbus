export default function OrContinueWith() {
  return (
    <div className="flex items-center gap-3 w-full my-1">
      <div className="h-px flex-1 bg-linear-to-r from-transparent via-(--border) to-transparent" />
      <span className="text-xs text-(--muted-foreground)/60 uppercase tracking-wider font-medium">
        or
      </span>
      <div className="h-px flex-1 bg-linear-to-r from-transparent via-(--border) to-transparent" />
    </div>
  );
}
