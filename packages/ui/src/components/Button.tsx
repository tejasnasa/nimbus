type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "sm" | "md" | "lg";
  ratio?: number;
};

const sizes = {
  sm: "p-2 px-3 text-sm",
  md: "h-10 px-4 text-md",
  lg: "h-12 px-6 text-lg",
};

export default function Button({
  className = "",
  size = "md",
  ratio,
  style,
  ...props
}: Props) {
  const base = sizes[size];

  return (
    <button
      {...props}
      style={{
        ...style,
        ...(ratio && { aspectRatio: ratio }),
      }}
      className={`
        bg-(--primary)
        text-(--primary-foreground)
        hover:bg-(--primary)/90
        rounded-md transition-all active:translate-y-0.5
        ${base}
        ${ratio ? "px-0" : ""} 
        ${className}
      `}
    />
  );
}
