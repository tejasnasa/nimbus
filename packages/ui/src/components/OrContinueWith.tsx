export default function OrContinueWith() {
  return (
    <div className="flex items-center gap-3 w-full">
      <div className="h-px flex-1 bg-(--border)" />
      <span className="text-xs text-(--muted-foreground)">
        Or continue with
      </span>
      <div className="h-px flex-1 bg-(--border)" />
    </div>
  );
}
