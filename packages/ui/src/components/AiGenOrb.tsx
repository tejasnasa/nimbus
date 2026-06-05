export function AIGenOrb() {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: 120, height: 120 }}
    >
      {/* Outer ambient glow */}
      <div
        className="animate-pulse-glow absolute rounded-full"
        style={{
          inset: -24,
          background:
            "radial-gradient(circle, color-mix(in oklch, var(--primary) 12%, transparent) 0%, transparent 65%)",
        }}
      />

      {/* Rotating ring - outer */}
      <div
        className="absolute rounded-full animate-spin-slow"
        style={{
          width: 112,
          height: 112,
          border:
            "1.5px solid color-mix(in oklch, var(--primary) 30%, transparent)",
          borderTopColor: "var(--primary)",
          borderRightColor:
            "color-mix(in oklch, var(--primary) 60%, transparent)",
        }}
      />

      {/* Rotating ring - inner, opposite direction */}
      <div
        className="absolute rounded-full"
        style={{
          width: 88,
          height: 88,
          border:
            "1px solid color-mix(in oklch, var(--sidebar-primary) 25%, transparent)",
          borderBottomColor: "var(--sidebar-primary)",
          borderLeftColor:
            "color-mix(in oklch, var(--sidebar-primary) 50%, transparent)",
          animation: "spin-slow 3s linear infinite reverse",
        }}
      />

      {/* Core orb */}
      <div
        className="animate-morph absolute"
        style={{
          width: 68,
          height: 68,
          borderRadius: "50%",
          background:
            "radial-gradient(ellipse at 38% 32%, color-mix(in oklch, var(--sidebar-primary) 90%, white), color-mix(in oklch, var(--primary) 75%, transparent) 55%, var(--card) 100%)",
          boxShadow:
            "inset 0 0 20px color-mix(in oklch, var(--sidebar-primary) 20%, transparent), 0 0 32px color-mix(in oklch, var(--primary) 35%, transparent)",
        }}
      >
        {/* Specular highlight */}
        <div
          className="absolute"
          style={{
            width: 22,
            height: 14,
            top: 14,
            left: 16,
            background:
              "color-mix(in oklch, var(--foreground) 20%, transparent)",
            borderRadius: "50%",
            filter: "blur(3px)",
            transform: "rotate(-25deg)",
          }}
        />
      </div>

      {/* Pulsing arc segments */}
      <svg
        className="absolute"
        width="120"
        height="120"
        viewBox="0 0 120 120"
        style={{ animation: "spin-slow 8s linear infinite" }}
      >
        <circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1.5"
          strokeDasharray="20 120 8 80 4 200"
          strokeOpacity="0.5"
          strokeLinecap="round"
        />
      </svg>

      <svg
        className="absolute"
        width="120"
        height="120"
        viewBox="0 0 120 120"
        style={{ animation: "spin-slow 5s linear infinite reverse" }}
      >
        <circle
          cx="60"
          cy="60"
          r="44"
          fill="none"
          stroke="var(--sidebar-primary)"
          strokeWidth="1"
          strokeDasharray="12 90 6 60"
          strokeOpacity="0.4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
