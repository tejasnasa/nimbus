export default function Button({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`bg-(--primary) text-(--primary-foreground) hover:bg-(--primary)/90 h-10 px-4 py-2 rounded-md transition-all active:translate-y-0.5 ${className}`}
    />
  );
}
