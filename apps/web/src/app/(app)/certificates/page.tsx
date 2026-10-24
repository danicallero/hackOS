"use client";

import { CertificatesPanel } from "@/components/certificates/certificates-panel";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { useLocale } from "@/lib/i18n";

export default function CertificatesPage() {
  const { t } = useLocale();
  return (
    <PageLayout>
      <PageHeader title={t("certificates")} />
      <CertificatesPanel />
    </PageLayout>
  );
}
