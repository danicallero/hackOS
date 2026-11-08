"use client";
import { useParams } from "next/navigation";
import { EmptyState } from "@/components/common/empty-state";
import { PageLayout } from "@/components/common/page-layout";
import { useLocale } from "@/lib/i18n";
import { PersonProfile, ProfileBackLink } from "../../../../people/[userId]/person-detail";
import type { HelpRequest } from "../../../model";
import { HelpdeskError, HelpdeskLoading, useHelpdesk } from "../../../shared";

/** H64: the requester's public profile, read from the request a helper can see. */
export default function RequesterPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const resource = useHelpdesk<HelpRequest>(
    ["request", id],
    `/api/helpdesk/requests/${encodeURIComponent(id)}`,
  );
  const profile = resource.data?.requesterProfile;
  const back = (
    <ProfileBackLink href={`/help-desk/requests/${id}`} label={t("helpDeskViewRequest")} />
  );
  if (!profile) {
    return (
      <PageLayout width="reading">
        {resource.loading ? <HelpdeskLoading /> : null}
        {resource.error ? (
          <HelpdeskError error={resource.error} retry={resource.refetch} />
        ) : resource.data ? (
          <EmptyState title={t("personNotFound")} />
        ) : null}
      </PageLayout>
    );
  }
  return <PersonProfile entry={profile} context={back} />;
}
