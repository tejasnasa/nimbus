"use client";

/**
 * @module web/components/FreeUsagePanel
 * @description Account-settings "Free usage" tab: how much of the operator's
 * free AI tier the signed-in user has left (document generations and assistant
 * minutes), and the workspaces they administer, where adding a key lifts the
 * limits for everyone there.
 *
 * Provider keys are not managed on this page. They belong to workspaces, so the
 * only thing the account has to say about them is where to go.
 */
import Link from "next/link";
import type { AiFreeState, AiFreeUsageDTO } from "@nimbus/types";
import { useAiFreeUsage } from "../hooks/useAiFreeUsage";

/** One allowance line: remaining of limit, or why there is none. */
function Allowance({
  label,
  state,
  remaining,
  limit,
  testId,
}: {
  label: string;
  state: AiFreeState;
  remaining: string;
  limit: string;
  testId: string;
}) {
  let copy: string;
  if (state === "unconfigured") {
    copy = "Not configured on this deployment.";
  } else if (state === "exhausted") {
    copy = `Used up: all ${limit} spent. A workspace key lifts the limit.`;
  } else {
    copy = `${remaining} of ${limit} remaining.`;
  }
  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-(--border) bg-(--muted)/30 px-4 py-3"
    >
      <h3 className="text-xs font-medium">{label}</h3>
      <p className="text-xs text-(--muted-foreground)">{copy}</p>
    </div>
  );
}

/**
 * @param props.initial - The server-rendered allowances.
 */
export default function FreeUsagePanel({ initial }: { initial: AiFreeUsageDTO }) {
  const { usage, error } = useAiFreeUsage(initial);
  const minutes = (seconds: number) => `${Math.floor(seconds / 60)} min`;

  return (
    <div className="space-y-6" data-testid="free-usage-panel">
      <p className="text-sm text-(--muted-foreground)">
        Without a workspace key, Nimbus uses the operator&apos;s free tier. The
        allowance is yours alone, however many workspaces you are in.
      </p>

      <Allowance
        label="Document generations"
        state={usage.docsState}
        remaining={String(usage.docsRemaining)}
        limit={String(usage.docsLimit)}
        testId="free-docs"
      />
      <Allowance
        label="Assistant time"
        state={usage.voiceState}
        remaining={minutes(usage.voiceSecondsRemaining)}
        limit={minutes(usage.voiceSecondsLimit)}
        testId="free-voice"
      />

      {error && (
        <p role="alert" className="text-xs text-(--destructive)">
          {error}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Workspaces you administer</h2>
        {usage.adminWorkspaces.length === 0 ? (
          <p className="text-xs text-(--muted-foreground)" data-testid="free-no-workspaces">
            You do not administer any workspace. Ask an admin to add a provider
            key in a workspace&apos;s AI settings.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="free-admin-workspaces">
            {usage.adminWorkspaces.map((w) => (
              <li
                key={w.id}
                className="flex items-center justify-between rounded-xl border border-(--border) px-3 py-2"
              >
                <span className="text-sm">{w.name}</span>
                <Link
                  href={`/workspace/${w.slugId}`}
                  data-testid={`free-workspace-link-${w.slugId}`}
                  className="text-xs text-(--primary) underline"
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
