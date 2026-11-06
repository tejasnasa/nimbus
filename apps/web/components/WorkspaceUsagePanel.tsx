"use client";

/**
 * @module web/components/WorkspaceUsagePanel
 * @description The workspace settings "Usage" tab, shown to admins and owners:
 * this month's totals per feature as stat tiles, then the call log (time,
 * member, feature, model, source, tokens or seconds, latency, cost, status)
 * with feature and status filters and a "Load more" button.
 *
 * Costs are estimates from list prices. A call whose model has no price shows a
 * dash rather than zero, so a missing price is visible instead of looking free.
 */
import Button from "@nimbus/ui/Button";
import { AI_FEATURES, type AiCallDTO, type AiFeature } from "@nimbus/types";
import { useWorkspaceAiUsage } from "../hooks/useWorkspaceAiUsage";

const STATUSES: ReadonlyArray<AiCallDTO["status"]> = [
  "ok",
  "error",
  "refused",
  "cancelled",
];

const usd = (value: number | null): string =>
  value === null ? "—" : `$${value.toFixed(4)}`;

/** Tokens for a text call, seconds for transcription, characters for speech. */
function usageCell(call: AiCallDTO): string {
  if (call.audioSeconds !== null) return `${call.audioSeconds.toFixed(1)} s`;
  if (call.characters !== null) return `${call.characters} chars`;
  if (call.inputTokens !== null || call.outputTokens !== null) {
    return `${call.inputTokens ?? 0} in / ${call.outputTokens ?? 0} out`;
  }
  return "—";
}

/**
 * @param props.workspaceId - The workspace cuid.
 */
export default function WorkspaceUsagePanel({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const usage = useWorkspaceAiUsage(workspaceId, true);

  return (
    <div className="space-y-6" data-testid="workspace-usage-panel">
      <p className="text-sm text-(--muted-foreground)">
        Every model call made in this workspace, estimated from list prices.
        {usage.totals ? ` Totals are for ${usage.totals.month} (UTC).` : ""}
      </p>

      <section
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        data-testid="usage-totals"
      >
        <StatTile
          label="All features"
          value={usd(usage.totals?.totalCostUsd ?? 0)}
          detail={`${usage.totals?.totalCalls ?? 0} calls`}
        />
        {usage.totals?.byFeature.map((f) => (
          <StatTile
            key={f.feature}
            label={f.feature}
            value={usd(f.costUsd)}
            detail={`${f.calls} calls${f.audioSeconds > 0 ? `, ${f.audioSeconds.toFixed(0)} s audio` : ""}`}
          />
        ))}
      </section>

      <div className="flex gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Feature
          <select
            data-testid="usage-filter-feature"
            className="rounded-lg border border-(--border) bg-(--background) px-2 py-1 text-sm"
            value={usage.filters.feature ?? ""}
            onChange={(e) =>
              usage.setFilters({
                ...usage.filters,
                feature: (e.target.value || undefined) as AiFeature | undefined,
              })
            }
          >
            <option value="">Any</option>
            {AI_FEATURES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Status
          <select
            data-testid="usage-filter-status"
            className="rounded-lg border border-(--border) bg-(--background) px-2 py-1 text-sm"
            value={usage.filters.status ?? ""}
            onChange={(e) =>
              usage.setFilters({
                ...usage.filters,
                status: (e.target.value || undefined) as
                  | AiCallDTO["status"]
                  | undefined,
              })
            }
          >
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {usage.error && (
        <p role="alert" className="text-xs text-(--destructive)" data-testid="usage-error">
          {usage.error}
        </p>
      )}

      {usage.loading ? (
        <p className="text-sm text-(--muted-foreground)">Loading usage…</p>
      ) : usage.calls.length === 0 ? (
        <p className="text-sm text-(--muted-foreground)" data-testid="usage-empty">
          No calls match.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="usage-table">
            <thead className="text-(--muted-foreground)">
              <tr>
                <th className="py-1 pr-3">Time</th>
                <th className="py-1 pr-3">Member</th>
                <th className="py-1 pr-3">Feature</th>
                <th className="py-1 pr-3">Model</th>
                <th className="py-1 pr-3">Source</th>
                <th className="py-1 pr-3">Usage</th>
                <th className="py-1 pr-3">Latency</th>
                <th className="py-1 pr-3">Cost</th>
                <th className="py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {usage.calls.map((call) => (
                <tr
                  key={call.id}
                  data-testid={`usage-row-${call.id}`}
                  className="border-t border-(--border)"
                >
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {new Date(call.createdAt).toLocaleString()}
                  </td>
                  <td className="py-1 pr-3">{call.userName ?? "—"}</td>
                  <td className="py-1 pr-3">{call.feature}</td>
                  <td className="py-1 pr-3 font-mono">{call.modelId}</td>
                  <td className="py-1 pr-3">{call.source}</td>
                  <td className="py-1 pr-3">{usageCell(call)}</td>
                  <td className="py-1 pr-3">{call.latencyMs} ms</td>
                  <td className="py-1 pr-3">{usd(call.costUsd)}</td>
                  <td className="py-1">
                    {call.status}
                    {call.errorReason ? ` (${call.errorReason})` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {usage.nextCursor && (
        <Button
          size="xs"
          data-testid="usage-load-more"
          loading={usage.loadingMore}
          onClick={() => void usage.loadMore()}
          className="rounded-lg hover:cursor-pointer"
        >
          Load more
        </Button>
      )}
    </div>
  );
}

/** One stat tile: a label, a headline figure and a detail line. */
function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div
      data-testid={`usage-tile-${label}`}
      className="rounded-xl border border-(--border) bg-(--muted)/30 px-3 py-2"
    >
      <p className="text-xs capitalize text-(--muted-foreground)">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-[11px] text-(--muted-foreground)">{detail}</p>
    </div>
  );
}
