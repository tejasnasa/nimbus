"use client";

/**
 * @module web/components/WorkspaceUsagePanel
 * @description The workspace settings "Usage" tab, shown to admins and owners:
 * this month's totals per feature as stat tiles, then the call log (time,
 * member, feature, model, source, tokens or seconds, latency, cost, status)
 * with feature and status filters, paged with Previous and Next.
 *
 * Costs are estimates from list prices. A call whose model has no price shows a
 * dash rather than zero, so a missing price is visible instead of looking free.
 */
import Select, { type SelectOption } from "@nimbus/ui/Select";
import { AI_FEATURES, type AiCallDTO, type AiFeature } from "@nimbus/types";
import { useWorkspaceAiUsage } from "../hooks/useWorkspaceAiUsage";
import Pagination from "./Pagination";

const STATUS_LABEL: Record<AiCallDTO["status"], string> = {
  ok: "OK",
  error: "Error",
  refused: "Refused",
  cancelled: "Cancelled",
};

/** "Any" plus one choice per value, labelled for people rather than code. */
const FEATURE_OPTIONS: readonly SelectOption[] = [
  { value: "", label: "Any" },
  ...AI_FEATURES.map((f) => ({
    value: f,
    label: f.charAt(0).toUpperCase() + f.slice(1),
  })),
];

const STATUS_OPTIONS: readonly SelectOption[] = [
  { value: "", label: "Any" },
  ...(Object.keys(STATUS_LABEL) as AiCallDTO["status"][]).map((s) => ({
    value: s,
    label: STATUS_LABEL[s],
  })),
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
        <Select
          id="usage-filter-feature"
          label="Feature"
          className="w-48"
          value={usage.filters.feature ?? ""}
          options={FEATURE_OPTIONS}
          onChange={(value) =>
            usage.setFilters({
              ...usage.filters,
              feature: (value || undefined) as AiFeature | undefined,
            })
          }
        />
        <Select
          id="usage-filter-status"
          label="Status"
          className="w-40"
          value={usage.filters.status ?? ""}
          options={STATUS_OPTIONS}
          onChange={(value) =>
            usage.setFilters({
              ...usage.filters,
              status: (value || undefined) as AiCallDTO["status"] | undefined,
            })
          }
        />
      </div>

      {usage.error && (
        <p
          role="alert"
          className="text-xs text-(--destructive)"
          data-testid="usage-error"
        >
          {usage.error}
        </p>
      )}

      {/* Only the first load shows a placeholder; paging keeps the current
          rows on screen, dimmed, until the next page replaces them. */}
      {usage.loading && usage.calls.length === 0 ? (
        <p className="text-sm text-(--muted-foreground)">Loading usage…</p>
      ) : usage.calls.length === 0 ? (
        <p
          className="text-sm text-(--muted-foreground)"
          data-testid="usage-empty"
        >
          No calls match.
        </p>
      ) : (
        <div
          className={`overflow-x-auto transition-opacity ${usage.loading ? "opacity-50" : ""}`}
        >
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
                    {STATUS_LABEL[call.status]}
                    {call.errorReason ? ` (${call.errorReason})` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        testId="usage-pagination"
        page={usage.page}
        hasPrevious={usage.hasPrevious}
        hasNext={usage.hasNext}
        disabled={usage.loading}
        onPrevious={() => void usage.previousPage()}
        onNext={() => void usage.nextPage()}
      />
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
