"use client";
import { useParams } from "next/navigation";
import { EmptyState } from "@/components/common/empty-state";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { isNotFoundError } from "@/lib/api";
import type { DirectoryEntry } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import { PersonProfile, ProfileBackLink } from "../../../people/[userId]/person-detail";
import type { HelperDetail } from "../../model";
import { ScheduleDays } from "../../schedule-view";
import { HelpdeskError, HelpdeskLoading, HelperPresence, useHelpdesk } from "../../shared";

/**
 * H63: a published helper is the same public profile people see after a
 * badge scan, plus the help desk's own facts: when they said they would be
 * around and whether they are scheduled and inside the venue right now.
 * Browsing creates no contact.
 */
export default function HelperPage() {
  const { userId } = useParams<{ userId: string }>();
  const { t } = useLocale();
  const resource = useHelpdesk<
    HelperDetail<DirectoryEntry> & { ownChallenges?: { id: number; name: string }[] }
  >(["helper", userId], `/api/helpdesk/helpers/${encodeURIComponent(userId)}`);
  const helper = resource.data;
  const back = <ProfileBackLink href="/help-desk" label={t("helpDeskHelpers")} />;
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
    >
      {resource.stale ? <StaleDataNotice onRetry={resource.refetch} /> : null}
      <dl className="divide-y divide-border/60 border-y border-border/60">
        {[
          [
            t("helpDeskRole"),
            [helper.visibleRoleName, helper.affiliation].filter(Boolean).join(" · "),
          ],
          ...(helper.ownChallenges?.length
            ? [[t("challenges"), helper.ownChallenges.map((item) => item.name).join(", ")]]
            : []),
        ].map(([label, value]) => (
          <div
            key={label}
            className="grid min-w-0 gap-1 py-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 wrap-anywhere">{value}</dd>
          </div>
        ))}
      </dl>
      <SectionCard variant="plain" title={t("helpDeskNowTitle")}>
        <HelperPresence helper={helper} />
      </SectionCard>
      <SectionCard variant="plain" title={t("helpDeskSchedule")}>
        <ScheduleDays intervals={helper.availability} />
      </SectionCard>
    </PersonProfile>
  );
}
