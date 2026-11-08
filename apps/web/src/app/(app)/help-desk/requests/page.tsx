"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { HelpRequest } from "../model";
import { RequestList } from "../request-list";
import { HelpdeskError, HelpdeskLoading, useHelpdesk } from "../shared";
import { RequestForm } from "./request-form";
export default function RequestsPage() {
  const { t } = useLocale();
  const allowed = useCan(CAPABILITIES.HELPDESK_REQUEST);
  const [open, setOpen] = useState(false);
  const resource = useHelpdesk<{ requests: HelpRequest[] }>(
    ["requests", "mine"],
    "/api/helpdesk/requests/mine",
    allowed,
  );
  if (!allowed) return <AccessDenied ask={t("noAccessTitle")} />;
  return (
    <PageLayout>
      <PageHeader
        reserveNavigation={false}
        title={t("helpDeskRequests")}
        primaryAction={<Button onClick={() => setOpen(true)}>{t("helpDeskRequestHelp")}</Button>}
      />
      {resource.stale ? <StaleDataNotice onRetry={resource.refetch} /> : null}
      {resource.error ? <HelpdeskError error={resource.error} retry={resource.refetch} /> : null}
      {resource.loading ? (
        <HelpdeskLoading />
      ) : resource.data ? (
        <RequestList requests={resource.data.requests} reload={resource.refetch} />
      ) : null}
      <Modal open={open} onOpenChange={setOpen} title={t("helpDeskRequestHelp")}>
        <RequestForm
          onSaved={() => {
            setOpen(false);
            resource.refetch();
          }}
        />
      </Modal>
    </PageLayout>
  );
}
