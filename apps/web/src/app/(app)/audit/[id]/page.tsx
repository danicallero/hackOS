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
import { auditChangedFields, auditLastEditedAt, diffAuditSnapshot } from "@/lib/audit-diff";
import {
  entityRef,
  getActionLabel,
  getAuditActorLabel,
  getAuditEntityHref,
  getAuditFieldLabel,
  getAuditSourceLabel,
  getAuditSummary,
  getAuditValueLabel,
} from "@/lib/audit-labels";
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

  const actor = getAuditActorLabel(row, t);
  const entityHref = getAuditEntityHref(row.entity_type, row.entity_id);
  const summary = getAuditSummary(row, actor, t);
  const diff = diffAuditSnapshot(row.before, row.after);
  const changedFields = [
    ...new Set([...(row.changed_fields ?? []), ...auditChangedFields(row.after)]),
  ];
  const lastEditedAt = row.last_edited_at ?? auditLastEditedAt(row.after);
  const hasContext = Boolean(row.reason || row.ip || row.user_agent);

  return (
    <PageLayout width="reading">
      <PageHeader
        title={getActionLabel(row.action, t)}
        meta={
          <span className="text-muted-foreground text-xs">
            #{row.id} · {formatEventDate(row.created_at, language, "dateTime")}
          </span>
        }
        state={
          row.source ? (
            <span className="text-muted-foreground text-xs capitalize">
              {getAuditSourceLabel(row.source, t)}
            </span>
          ) : undefined
        }
        description={summary}
      />

      <SectionCard title={t("colEntity")}>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">{t("colEntity")}</dt>
            <dd className="wrap-break-word">
              {entityHref ? (
                <Link href={entityHref} className="hover:underline">
                  {entityRef(row.entity_type, row.entity_id, t)}
                </Link>
              ) : (
                entityRef(row.entity_type, row.entity_id, t)
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
          {row.initiated_by && (
            <div>
              <dt className="text-muted-foreground text-xs">{t("auditInitiatedBy")}</dt>
              <dd>
                <Link href={`/users/${row.initiated_by}`} className="hover:underline">
                  {row.initiator_name || `#${row.initiated_by}`}
                </Link>
              </dd>
            </div>
          )}
          {row.request_id && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground text-xs">{t("auditRelatedActions")}</dt>
              <dd>
                <Link href={`/audit?request=${row.request_id}`} className="hover:underline">
                  {t("auditViewRelatedActions")}
                </Link>
              </dd>
            </div>
          )}
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

      {(changedFields.length > 0 || (diff && diff.length > 0)) && (
        <SectionCard title={t("auditChangedFieldsTitle")}>
          {changedFields.length > 0 && (
            <>
              <ul className="list-inside list-disc text-sm">
                {changedFields.map((field) => (
                  <li key={field}>{getAuditFieldLabel(field, t)}</li>
                ))}
              </ul>
              <p className="text-muted-foreground text-xs">{t("auditPrivateContentOmitted")}</p>
            </>
          )}
          {lastEditedAt && (
            <p className="text-muted-foreground text-xs">
              {t("auditLastEdited", { time: formatEventDate(lastEditedAt, language, "dateTime") })}
            </p>
          )}
          {diff && diff.length > 0 && (
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
                      <td className="p-2 font-mono text-xs">{getAuditFieldLabel(d.key, t)}</td>
                      <td className="p-2 wrap-break-word">
                        {getAuditValueLabel(d.before, d.key, row.entity_type, t)}
                      </td>
                      <td className="p-2 wrap-break-word">
                        {getAuditValueLabel(d.after, d.key, row.entity_type, t)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
      {diff?.length === 0 && changedFields.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("auditNoChangeDetails")}</p>
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
