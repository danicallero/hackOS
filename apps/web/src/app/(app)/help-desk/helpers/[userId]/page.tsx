"use client";
import { useParams, useSearchParams } from "next/navigation";
import { BackLink } from "@/components/common/back-link";
import { EmptyState } from "@/components/common/empty-state";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { isNotFoundError } from "@/lib/api";
import type { DirectoryEntry } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import { PersonProfile } from "../../../people/[userId]/person-detail";
import { AvailabilityTimeline } from "../../availability-timeline";
import type { HelperDetail } from "../../model";
import { requestListSource } from "../../navigation";
import { HelpdeskError, HelpdeskLoading, useHelpdesk } from "../../shared";

/**
 * H63: a published helper is the same public profile people see after a
 * badge scan, plus the help desk's own facts: when they said they would be
 * around and whether they are scheduled and inside the venue right now.
 * Browsing creates no contact.
 */
export default function HelperPage() {
  const { userId } = useParams<{ userId: string }>();
  const { t } = useLocale();
  const search = useSearchParams();
  const selected = search.get("tab");
  const requestId = search.get("request");
  const source = requestListSource(search.get("from"));
  const requestBack =
    requestId && /^\d+$/.test(requestId)
      ? `/help-desk/requests/${requestId}${source ? `?from=${encodeURIComponent(source)}` : ""}`
      : null;
  const suffix =
    selected && ["mine", "open", "claims"].includes(selected) ? `?tab=${selected}` : "";
  const resource = useHelpdesk<HelperDetail<DirectoryEntry>>(
    ["helper", userId],
    `/api/helpdesk/helpers/${encodeURIComponent(userId)}`,
  );
  const helper = resource.data;
  const back = (
    <BackLink
      href={requestBack ?? `/help-desk/helpers${suffix}`}
      label={t(requestBack ? "helpDeskViewRequest" : "helpDeskHelpers")}
    />
  );
  if (!helper) {
    return (
      <PageLayout width="reading">
        {resource.loading ? <HelpdeskLoading /> : null}
        {isNotFoundError(resource.error) ? (
          <EmptyState title={t("personNotFound")} />
        ) : resource.error ? (
          <HelpdeskError error={resource.error} retry={resource.refetch} />
        ) : null}
      </PageLayout>
    );
  }
  return (
    <PersonProfile
      entry={{
        ...helper.profile,
        helpTopics: helper.profile.helpTopics?.length ? helper.profile.helpTopics : helper.topics,
      }}
      context={back}
      visibleRole={helper.visibleRoleName}
      present={helper.present}
      company={
        helper.affiliation
          ? { name: helper.affiliation, logoUrl: helper.affiliationLogoUrl }
          : undefined
      }
    >
      {resource.stale ? <StaleDataNotice onRetry={resource.refetch} /> : null}
      {helper.challenges.length ? (
        <SectionCard variant="plain" title={t("challenges")}>
          <p className="text-sm">{helper.challenges.map((item) => item.name).join(", ")}</p>
        </SectionCard>
      ) : null}
      <SectionCard variant="plain" title={t("helpDeskSchedule")}>
        <AvailabilityTimeline intervals={helper.availability} readOnly />
      </SectionCard>
    </PersonProfile>
  );
}
