/**
 * @module web/components/landing/ByokSection
 * @description The "Bring your own keys, see every call" section: the three
 * promises on the left and a decorative usage-log panel on the right whose rows
 * rotate on a timer, with a spend bar against a sample monthly cap.
 *
 * @important The usage rows, costs and cap are illustrative sample figures,
 *            not data; the panel is `aria-hidden`.
 */
"use client";
import { CheckIcon, Eyebrow, SectionTitle } from "./parts";
import { useTick } from "./useTick";

const USAGE = [
  { feature: "Live captions", provider: "OpenRouter", amount: "58 s audio", cost: "$0.0006" },
  { feature: "Voice answer", provider: "OpenRouter", amount: "1.2k tokens", cost: "$0.0004" },
  { feature: "Meeting notes", provider: "DeepSeek", amount: "6.8k tokens", cost: "$0.0019" },
  { feature: "Sketch to diagram", provider: "OpenAI", amount: "1 image", cost: "$0.0031" },
  { feature: "Caption translation", provider: "Groq", amount: "940 tokens", cost: "$0.0002" },
  { feature: "Chat draft", provider: "DeepSeek", amount: "3.1k tokens", cost: "$0.0009" },
];

const PROMISES = [
  "Keys are encrypted and scoped to one workspace",
  "Tokens, audio seconds, latency and cost for every call",
  "An optional monthly spend cap, so there are no surprises",
];

const ROW = "grid grid-cols-[1.6fr_1.3fr_1fr_0.8fr] gap-3";

/** Renders the bring-your-own-keys section. */
export default function ByokSection() {
  const { tick, animate } = useTick();
  const off = animate ? Math.floor(tick / 4) % USAGE.length : 0;
  const rows = [0, 1, 2, 3, 4].map((k) => USAGE[(off + k) % USAGE.length]!);
  const spent = 4.12 + off * 0.07;

  return (
    <section className="flex flex-wrap items-center gap-14 pt-20 pb-10 sm:pt-25">
      <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-4.5">
        <Eyebrow>Your models, your bill</Eyebrow>
        <SectionTitle first="Bring your own keys," accent="see every call." />
        <p className="text-base leading-[1.65] text-(--text-body)">
          Workspace admins add keys for OpenAI, Groq, DeepSeek or OpenRouter,
          and pick the model for each feature. Every request lands in a usage
          log with its cost.
        </p>
        <ul className="flex flex-col gap-3 pt-1.5">
          {PROMISES.map((p) => (
            <li
              key={p}
              className="flex items-start gap-3 text-[15px] text-(--text-strong)"
            >
              <CheckIcon />
              {p}
            </li>
          ))}
        </ul>
      </div>

      <div
        className="flex min-w-0 flex-[1_1_560px] flex-col gap-4 rounded-[20px] border border-(--line-2) bg-(--surface-1) p-5.5"
        aria-hidden="true"
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span className="text-[15px] font-semibold">Usage · this month</span>
          <span className="font-mono text-xs text-(--muted-foreground)">
            ${spent.toFixed(2)} of $20.00 cap
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-(--line-1)">
          <div
            className="h-2 rounded bg-(--violet) transition-[width] duration-600 motion-reduce:transition-none"
            style={{ width: `${Math.round((spent / 20) * 100)}%` }}
          />
        </div>
        <div className="overflow-x-auto">
          <div className="flex min-w-120 flex-col">
            <div
              className={`${ROW} border-b border-(--line-1) px-1 py-2 font-mono text-[11px] tracking-[0.08em] text-(--muted-foreground) uppercase`}
            >
              <span>Feature</span>
              <span>Provider</span>
              <span>Amount</span>
              <span className="text-right">Cost</span>
            </div>
            {rows.map((u, k) => (
              <div
                key={u.feature}
                className={`${ROW} border-b border-[#1d1a21] px-1 py-3 text-sm text-(--text-strong) transition-colors duration-600 motion-reduce:transition-none ${
                  k === 0 && animate ? "bg-[rgba(124,207,0,0.07)]" : ""
                }`}
              >
                <span>{u.feature}</span>
                <span className="text-(--muted-foreground)">{u.provider}</span>
                <span className="font-mono text-(--text-body)">{u.amount}</span>
                <span className="text-right font-mono">{u.cost}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
