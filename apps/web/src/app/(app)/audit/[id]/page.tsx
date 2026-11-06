"use client";

// H53 audit log detail — a record's own page (docs/DESIGN.md dialog-vs-route
// rule), replacing the old full-record Modal so an entry can be linked,
// shared, and opened from the row itself instead of trapped behind a click.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { useServerResource } from "@/hooks/use-server-resource";
import { apiErrorText } from "@/lib/api-error-text";
import { diffAuditSnapshot, formatDiffValue } from "@/lib/audit-diff";
import { auditActorLabel, getActionLabel, getAuditSummary } from "@/lib/audit-labels";
import { formatEventDate } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { notificationsApi } from "@/lib/notifications";
import { useCan } from "@/lib/session";

export default function AuditEntryPage() {
  const { t, language } = useLocale();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const canRead = useCan(CAPABILITIES.AUDIT_READ);

  const valid = Number.isFinite(id);
  const {
    data: row,
    error,
    loading,
  } = useServerResource(["audit", "entry", id], () => notificationsApi.getAuditEntry(id), {
    enabled: canRead && valid,
  });

  if (!canRead) {
    return <AccessDenied ask={t("auditLogAccessDeniedDesc")} />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!row) {
    return (
      <div className="space-y-6">
        <EmptyState
          title={t("auditEntryNotFound")}
          description={error ? apiErrorText(error, t, t("couldNotLoadAuditLog")) : undefined}
        />
      </div>
    );
  }

  const actor = row.actor_id ? (auditActorLabel(row) ?? `#${row.actor_id}`) : t("systemActor");
  const summary = getAuditSummary(row, actor, t);
  const diff = diffAuditSnapshot(row.before, row.after);
  const hasContext = Boolean(row.reason || row.ip || row.user_agent);

  return (
    <PageLayout width="reading">
      <PageHeader
        title={getActionLabel(row.action, t)}
        meta={
          <span className="text-muted-foreground text-xs">
            {formatEventDate(row.created_at, language, "dateTime")}
          </span>
        }
        state={
          row.source ? (
            <span className="text-muted-foreground text-xs capitalize">{row.source}</span>
          ) : undefined
        }
        description={summary}
      />

      <SectionCard title={t("colEntity")}>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">{t("colEntity")}</dt>
            <dd className="wrap-break-word">
              {row.entity_type === "user" ? (
                <Link href={`/users/${row.entity_id}`} className="hover:underline">
                  {t("userInline", { id: row.entity_id })}
                </Link>
              ) : (
                `${row.entity_type} #${row.entity_id}`
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("colActor")}</dt>
            <dd className="wrap-break-word">
              {row.actor_id ? (
                <Link href={`/users/${row.actor_id}`} className="hover:underline">
                  {actor}
                </Link>
              ) : (
                actor
              )}
            </dd>
          </div>
        </dl>
      </SectionCard>

      {hasContext && (
        <SectionCard title={t("auditContextTitle")}>
          <dl className="grid gap-3 sm:grid-cols-3">
            {row.reason && (
              <div>
                <dt className="text-muted-foreground text-xs">{t("reasonLabel")}</dt>
                <dd className="wrap-break-word">{row.reason}</dd>
              </div>
            )}
            {row.ip && (
              <div>
                <dt className="text-muted-foreground text-xs">{t("ipLabel")}</dt>
                <dd className="wrap-break-word">{row.ip}</dd>
              </div>
            )}
            {row.user_agent && (
              <div>
                <dt className="text-muted-foreground text-xs">{t("userAgentLabel")}</dt>
                <dd className="wrap-break-word text-xs">{row.user_agent}</dd>
              </div>
            )}
          </dl>
        </SectionCard>
      )}

      {diff && diff.length > 0 && (
        <SectionCard title={t("auditChangedFieldsTitle")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs">
                  <th className="p-2 text-left font-medium">{t("auditFieldLabel")}</th>
                  <th className="p-2 text-left font-medium">{t("beforeLabel")}</th>
                  <th className="p-2 text-left font-medium">{t("afterLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {diff.map((d) => (
                  <tr key={d.key} className="border-border border-t">
                    <td className="p-2 font-mono text-xs">{d.key}</td>
                    <td className="p-2 wrap-break-word">{formatDiffValue(d.before)}</td>
                    <td className="p-2 wrap-break-word">{formatDiffValue(d.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {!diff && (row.before != null || row.after != null) && (
        <SectionCard title={t("auditChangedFieldsTitle")}>
          <div className="grid gap-3 sm:grid-cols-2">
            {row.before != null && (
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">{t("beforeLabel")}</p>
                <pre className="bg-muted max-h-64 overflow-auto rounded-md p-3 text-xs">
                  {JSON.stringify(row.before, null, 2)}
                </pre>
              </div>
            )}
            {row.after != null && (
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">{t("afterLabel")}</p>
                <pre className="bg-muted max-h-64 overflow-auto rounded-md p-3 text-xs">
                  {JSON.stringify(row.after, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </PageLayout>
  );
}
