import { Spinner } from "./icons/Spinner";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "xs" | "sm" | "md" | "lg";
  ratio?: number;
  loading?: boolean;
};

const sizes = {
  xs: "px-2 py-1 text-xs",
  sm: "p-2 px-3 text-sm",
  md: "h-10 px-4 text-md",
  lg: "h-12 px-6 text-lg",
};

const iconSizes = {
  xs: "h-2 w-2",
  sm: "h-3 w-3",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

export default function Button({
  className = "",
  size = "md",
  ratio,
  style,
  loading = false,
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
      disabled={loading || props.disabled}
      className={` bg-(--primary) text-(--primary-foreground) hover:bg-(--primary)/90 rounded-md transition-all active:translate-y-0.5 inline-flex items-center justify-center gap-2 disabled:bg-(--primary)/50 disabled:cursor-default ${base} ${ratio ? "px-0" : ""} ${className}
      `}
    >
      {loading && <Spinner className={iconSizes[size]} />}

      {props.children}
    </button>
  );
}
