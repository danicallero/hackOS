"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import type { HelperCard } from "../../model";
import {
  Availability,
  HelpdeskError,
  HelpdeskLoading,
  HelperPresence,
  useHelpdesk,
} from "../../shared";
export default function HelperPage() {
  const { userId } = useParams<{ userId: string }>();
  const { t } = useLocale();
  const resource = useHelpdesk<HelperCard>(
    ["helper", userId],
    `/api/helpdesk/helpers/${encodeURIComponent(userId)}`,
  );
  const helper = resource.data;
  return (
    <PageLayout width="reading">
      {helper ? (
        <>
          <PageHeader
            reserveNavigation={false}
            context={<Link href="/help-desk">{t("helpDeskHelpers")}</Link>}
            title={helper.displayName}
            leading={
              helper.photoUrl ? (
                <UserAvatar name={helper.displayName} image={helper.photoUrl} decorative />
              ) : undefined
            }
            meta={helper.affiliation || helper.headline}
          />
          <HelperPresence helper={helper} />
          <p className="text-sm whitespace-pre-line wrap-anywhere">{helper.bio}</p>
          <SectionCard variant="plain" title={t("helpDeskKnowledge")}>
            <p className="text-sm">{helper.topics.map((topic) => topic.name).join(" · ")}</p>
          </SectionCard>
          <SectionCard variant="plain" title={t("helpDeskSchedule")}>
            <Availability intervals={helper.availability} />
          </SectionCard>
        </>
      ) : resource.loading ? (
        <HelpdeskLoading />
      ) : null}
      {resource.stale ? <StaleDataNotice onRetry={resource.refetch} /> : null}
      {resource.error ? <HelpdeskError error={resource.error} retry={resource.refetch} /> : null}
      <Button asChild variant="outline">
        <Link href="/help-desk">{t("back")}</Link>
      </Button>
    </PageLayout>
  );
}
