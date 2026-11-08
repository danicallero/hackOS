"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import Link from "next/link";
import { useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import type { HelperCard } from "./model";
import {
  Availability,
  HelpdeskError,
  HelpdeskLoading,
  HelperPresence,
  useHelpdesk,
} from "./shared";

export default function HelpdeskPage() {
  const { t } = useLocale();
  const { canAny } = useSessionContext();
  const allowed = canAny(
    CAPABILITIES.HELPDESK_REQUEST,
    CAPABILITIES.HELPDESK_OFFER,
    CAPABILITIES.HELPDESK_COVERAGE,
  );
  const [query, setQuery] = useState("");
  const helpers = useHelpdesk<{ helpers: HelperCard[] }>(
    ["helpers", query],
    `/api/helpdesk/helpers?q=${encodeURIComponent(query)}`,
    allowed,
  );
  if (!allowed) return <AccessDenied ask={t("noAccessTitle")} />;
  return (
    <PageLayout>
      <PageHeader reserveNavigation={false} title={t("helpDeskHelpers")} />
      <ListToolbar
        search={{
          value: query,
          onValueChange: setQuery,
          placeholder: t("helpDeskSearch"),
          label: t("helpDeskSearch"),
        }}
      />
      {helpers.stale ? <StaleDataNotice onRetry={helpers.refetch} /> : null}
      {helpers.error ? <HelpdeskError error={helpers.error} retry={helpers.refetch} /> : null}
      {helpers.loading ? (
        <HelpdeskLoading />
      ) : helpers.data?.helpers.length === 0 ? (
        <EmptyState
          title={t(query ? "helpDeskNoMatches" : "helpDeskNoHelpers")}
          action={
            query ? (
              <Button variant="outline" onClick={() => setQuery("")}>
                {t("clearFilters")}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      <div className="grid items-start gap-x-8 gap-y-6 lg:grid-cols-2">
        {helpers.data?.helpers.map((helper) => (
          <SectionCard
            key={helper.userId}
            variant="plain"
            title={helper.displayName}
            action={
              <Button asChild variant="outline" size="sm">
                <Link href={`/help-desk/helpers/${helper.userId}`}>{t("viewProfile")}</Link>
              </Button>
            }
          >
            <div className="space-y-3 border-t pt-4">
              <HelperPresence helper={helper} />
              {helper.affiliation || helper.headline ? (
                <p className="text-muted-foreground text-sm">
                  {[helper.affiliation, helper.headline].filter(Boolean).join(" · ")}
                </p>
              ) : null}
              <p className="text-sm whitespace-pre-line wrap-anywhere">{helper.bio}</p>
              <p className="text-sm">{helper.topics.map((topic) => topic.name).join(" · ")}</p>
              <div className="space-y-2">
                <h3 className="type-label">{t("helpDeskSchedule")}</h3>
                <Availability intervals={helper.availability} />
              </div>
            </div>
          </SectionCard>
        ))}
      </div>
    </PageLayout>
  );
}
