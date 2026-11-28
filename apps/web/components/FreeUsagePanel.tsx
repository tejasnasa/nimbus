"use client";

/**
 * @module web/components/FreeUsagePanel
 * @description Account-settings "Free usage" tab: how much of the operator's
 * free AI tier the signed-in user has left (document generations and assistant
 * minutes) as two meters, and the workspaces they administer, where adding a
 * key lifts the limits for everyone there.
 *
 * Provider keys are not managed on this page. They belong to workspaces, so the
 * only thing the account has to say about them is where to go.
 */
import Link from "next/link";
import type { AiFreeState, AiFreeUsageDTO } from "@nimbus/types";
import { useAiFreeUsage } from "../hooks/useAiFreeUsage";

const cardClass =
  "flex flex-col gap-5 rounded-[18px] border border-(--line-2) bg-(--surface-1) p-6.5";

/** One allowance meter: remaining of limit, or why there is none. */
function Allowance({
  label,
  state,
  remaining,
  limit,
  fraction,
  barClass,
  testId,
}: {
  label: string;
  state: AiFreeState;
  remaining: string;
  limit: string;
  fraction: number;
  barClass: string;
  testId: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-3 rounded-[14px] border border-(--line-1) bg-(--panel) p-4.5"
    >
      <h3 className="text-[13px] font-normal text-(--muted-foreground)">
        {label}
      </h3>
      {state === "unconfigured" ? (
        <p className="text-sm text-(--muted-foreground)">
          Not configured on this deployment.
        </p>
      ) : state === "exhausted" ? (
        <p className="text-sm text-(--muted-foreground)">
          Used up: all {limit} spent. A workspace key lifts the limit.
        </p>
      ) : (
        <>
          <p className="font-display text-[30px] leading-tight font-semibold">
            <span>{remaining}</span>{" "}
            <span className="text-[15px] font-medium text-(--muted-foreground)">
              of {limit} remaining
            </span>
          </p>
          <div
            aria-hidden="true"
            className="h-1.5 overflow-hidden rounded-[3px] bg-(--line-1)"
          >
            <div
              className={`h-full rounded-[3px] ${barClass}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * @param props.initial - The server-rendered allowances.
 */
export default function FreeUsagePanel({ initial }: { initial: AiFreeUsageDTO }) {
  const { usage, error } = useAiFreeUsage(initial);
  const minutes = (seconds: number) => `${Math.floor(seconds / 60)} min`;
  const ratio = (left: number, total: number) => (total > 0 ? left / total : 0);

  return (
    <div className="flex flex-col gap-4.5" data-testid="free-usage-panel">
      <div className={cardClass}>
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-[22px] font-semibold">Free usage</h2>
          <p className="text-sm text-(--muted-foreground)">
            Without a workspace key, Nimbus uses the operator&apos;s free tier.
            The allowance is yours alone, however many workspaces you are in.
          </p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3.5">
          <Allowance
            label="Document generations"
            state={usage.docsState}
            remaining={String(usage.docsRemaining)}
            limit={String(usage.docsLimit)}
            fraction={ratio(usage.docsRemaining, usage.docsLimit)}
            barClass="bg-(--violet)"
            testId="free-docs"
          />
          <Allowance
            label="Assistant time"
            state={usage.voiceState}
            remaining={minutes(usage.voiceSecondsRemaining)}
            limit={minutes(usage.voiceSecondsLimit)}
            fraction={ratio(usage.voiceSecondsRemaining, usage.voiceSecondsLimit)}
            barClass="bg-(--lime)"
            testId="free-voice"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs text-(--destructive)">
            {error}
          </p>
        )}
      </div>

      <section className={`${cardClass} gap-3.5`}>
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-semibold">
            Workspaces you administer
          </h2>
          <p className="text-sm text-(--muted-foreground)">
            Keys belong to workspaces. Add one to a workspace you manage and
            nobody there needs the free tier.
          </p>
        </div>
        {usage.adminWorkspaces.length === 0 ? (
          <p
            className="text-[13px] text-(--muted-foreground)"
            data-testid="free-no-workspaces"
          >
            You do not administer any workspace. Ask an admin to add a provider
            key in a workspace&apos;s AI settings.
          </p>
        ) : (
          <ul className="flex flex-col gap-3.5" data-testid="free-admin-workspaces">
            {usage.adminWorkspaces.map((w) => (
              <li
                key={w.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-(--line-1) bg-(--panel) px-3.5 py-3"
              >
                <span className="text-sm">{w.name}</span>
                <Link
                  href={`/workspace/${w.slugId}`}
                  data-testid={`free-workspace-link-${w.slugId}`}
                  className="text-[13px] text-(--violet-soft) hover:underline focus-visible:outline-2 focus-visible:outline-(--violet)"
                >
                  Open, then Settings → AI
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
