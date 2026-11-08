"use client";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { MultiSelect } from "@/components/common/multi-select";
import { StatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { type MessageKey, useLocale } from "@/lib/i18n";
import type { HelperCard, HelpTopic } from "./model";

export function useHelpdesk<T>(key: readonly (string | number)[], path: string, enabled = true) {
  const resource = useLiveQuery(
    (signal) => api.get<T>(path, { signal }),
    domainScope(SSE_TOPICS.HELPDESK),
    [EVENTS.DOMAIN_CHANGED, EVENTS.HELPDESK_REQUEST_CHANGED],
    { resourceKey: ["helpdesk", ...key], enabled },
  );
  const timeSensitive = ["helpers", "helper", "coverage"].includes(String(key[0]));
  useEffect(() => {
    if (!enabled || !timeSensitive) return;
    // H62/H67: a schedule boundary changes coverage without a domain mutation.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") resource.refetch();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, timeSensitive, resource.refetch]);
  return resource;
}
export function HelpdeskError({
  error,
  retry,
  fallback = "helpDeskLoadError",
}: {
  error: unknown;
  retry?: () => void;
  fallback?: MessageKey;
}) {
  const { t } = useLocale();
  return <ContextualError message={apiErrorText(error, t, t(fallback))} onRetry={retry} />;
}
export function HelpdeskLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      {[1, 2, 3].map((n) => (
        <Skeleton key={n} className="h-24 w-full" />
      ))}
    </div>
  );
}
const OTHER = "other";
export function TopicsPicker({
  value,
  onChange,
  disabled,
  id,
  inDialog = false,
  other,
  allowAdd = false,
}: {
  value: HelpTopic[];
  onChange: (topics: HelpTopic[]) => void;
  disabled?: boolean;
  id?: string;
  inDialog?: boolean;
  /** Request forms only: Other is the last row of the same list. */
  other?: { value: boolean; onChange: (other: boolean) => void };
  /** Support profile only: eligible people may add topics to the catalogue (the API refuses others). */
  allowAdd?: boolean;
}) {
  const { t } = useLocale();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);
  const resource = useServerResource(["helpdesk", "topics", q], (signal) =>
    api.get<{ topics: HelpTopic[] }>("/api/helpdesk/topics", { signal, query: { q, limit: 50 } }),
  );
  const options = [
    ...new Map(
      [...value, ...(resource.data?.topics ?? [])].map((topic) => [topic.id, topic]),
    ).values(),
  ];
  const choices = [
    ...(other
      ? [{ value: OTHER, label: t("helpDeskOther"), description: t("helpDeskOtherHint") }]
      : []),
    ...options.map((topic) => ({ value: String(topic.id), label: topic.name })),
  ];
  return (
    <div className="space-y-2">
      <MultiSelect
        id={id}
        aria-label={id ? undefined : t("helpDeskKnowledge")}
        disabled={disabled}
        inDialog={inDialog}
        options={choices}
        value={[...value.map((topic) => String(topic.id)), ...(other?.value ? [OTHER] : [])]}
        onChange={(ids) => {
          // Other excludes the catalogue: picking one side clears the other.
          const pickedOther = ids.includes(OTHER) && !other?.value;
          const topicIds = pickedOther ? [] : ids.filter((id) => id !== OTHER);
          other?.onChange(pickedOther || (ids.includes(OTHER) && topicIds.length === 0));
          onChange(
            topicIds.map((id) => options.find((topic) => String(topic.id) === id)!).filter(Boolean),
          );
        }}
        creating={creating}
        searchPlaceholder={t(allowAdd ? "helpDeskFindOrAddTopic" : "helpDeskFindTopic")}
        onCreateOption={
          allowAdd
            ? async (name) => {
                setCreating(true);
                setCreateError(null);
                try {
                  const result = await api.post<{ topic: HelpTopic }>("/api/helpdesk/topics", {
                    name,
                  });
                  other?.onChange(false);
                  onChange([
                    ...value.filter((topic) => topic.id !== result.topic.id),
                    result.topic,
                  ]);
                  setQ("");
                  resource.reload();
                } catch (error) {
                  setCreateError(error);
                } finally {
                  setCreating(false);
                }
              }
            : undefined
        }
        searchQuery={q}
        onSearchChange={setQ}
        placeholder={t("selectPlaceholder")}
      />
      {createError ? <HelpdeskError error={createError} /> : null}
      {resource.error ? <HelpdeskError error={resource.error} retry={resource.reload} /> : null}
    </div>
  );
}
/**
 * H62/H63: stated schedule and venue presence are separate facts; each keeps
 * its own labelled marker so "scheduled" never reads as "inside".
 */
export function HelperPresence({
  helper,
}: {
  helper: Pick<HelperCard, "scheduledNow" | "present">;
}) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1">
      <StatusBadge tone={helper.scheduledNow ? "info" : "neutral"}>
        {t(helper.scheduledNow ? "helpDeskScheduledNow" : "helpDeskNotScheduled")}
      </StatusBadge>
      <StatusBadge tone={helper.present ? "success" : "neutral"}>
        {t(helper.present ? "helpDeskPresent" : "helpDeskOutside")}
      </StatusBadge>
    </div>
  );
}

/** H61: who the person is on the support team, as a capsule; the company stays in the text. */
export function RolePill({ role }: { role: string | null }) {
  return role ? <Badge variant="secondary">{role}</Badge> : null;
}
