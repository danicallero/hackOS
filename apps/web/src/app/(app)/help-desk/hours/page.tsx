"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { AccessDenied } from "@/components/common/access-denied";
import { PageLayout } from "@/components/common/page-layout";
import { HelpDeskSectionHeader } from "@/components/common/section-navigation";
import { useHelpdeskSchedule } from "@/hooks/use-helpdesk-schedule";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { HelpdeskError, HelpdeskLoading } from "../shared";
import { HoursEditor } from "./hours-editor";

/** H64: organizers set when the help desk accepts new requests. */
export default function HelpdeskHoursPage() {
  const { t } = useLocale();
  const allowed = useCan(CAPABILITIES.HELPDESK_MANAGE);
  const resource = useHelpdeskSchedule(allowed);
  if (!allowed) return <AccessDenied ask={t("noAccessTitle")} />;
  return (
    <PageLayout>
      <HelpDeskSectionHeader />
      {resource.error ? <HelpdeskError error={resource.error} retry={resource.reload} /> : null}
      {resource.data ? (
        <HoursEditor schedule={resource.data} onSaved={resource.mutate} />
      ) : resource.loading ? (
        <HelpdeskLoading />
      ) : null}
    </PageLayout>
  );
}
