"use client";

import { IdCardIcon, TicketIcon, UserIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { QrCode } from "@/components/common/qr-code";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { TabBar } from "@/components/common/tab-bar";
import { WalletButtons, type WalletPurpose } from "@/components/common/wallet-buttons";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import { logisticsApi, type TicketQrPayload } from "@/lib/logistics";
import { useMe } from "@/lib/session";
import type { Me } from "@/lib/types";
import { useUrlTab } from "@/lib/url-tab";

type Purpose = WalletPurpose;

export default function WalletPage() {
  const me = useMe();
  const { t } = useLocale();
  const { tab: purpose, setTab: setPurpose } = useUrlTab({
    values: ["ticket", "badge"] as const,
    defaultValue: "ticket",
  });
  const [payload, setPayload] = useState<TicketQrPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPayload(await logisticsApi.myTicket());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("couldNotLoadYourApplications"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function retry() {
    void load();
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("wallet")} />
        <div className="text-muted-foreground flex flex-col items-center gap-3 py-16" role="status">
          <Spinner className="size-6" />
          <span className="text-sm">{t("loading")}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("wallet")} />
        <ContextualError message={error} onRetry={retry} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("wallet")} />

      <Tabs value={purpose} onValueChange={setPurpose}>
        <TabBar>
          <TabsTrigger value="ticket">{t("entranceTicket")}</TabsTrigger>
          <TabsTrigger value="badge">{t("badge")}</TabsTrigger>
        </TabBar>
        <TabsContent value="ticket" className="space-y-6 pt-4">
          <WalletPurposePanel purpose="ticket" value={payload?.ticketToken} />
        </TabsContent>
        <TabsContent value="badge" className="space-y-6 pt-4">
          <WalletPurposePanel purpose="badge" value={payload?.badgeId} />
        </TabsContent>
      </Tabs>

      {me ? (
        <SectionCard title={t("walletHolder")} icon={UserIcon}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("walletHolderName")}
              value={[me.name, me.surname].filter(Boolean).join(" ") || me.email}
            />
            <Field label={t("walletHolderRole")} value={roleLabel(me.visibleRoleName, t)} />
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

/** H8: roles are arbitrary names now — show the name as-is. */
function roleLabel(role: Me["visibleRoleName"], t: Translate): string {
  return role ?? t("roleUnassigned");
}

function WalletPurposePanel({ purpose, value }: { purpose: Purpose; value?: string | null }) {
  const { t } = useLocale();
  const icon = purpose === "ticket" ? TicketIcon : IdCardIcon;

  if (!value) {
    return (
      <EmptyState
        icon={icon}
        title={purpose === "ticket" ? t("ticketNotReadyTitle") : t("badgeNotReadyTitle")}
        description={purpose === "ticket" ? t("noTicketYet") : t("noBadgeYet")}
      />
    );
  }

  const Icon = icon;
  return (
    <>
      <div className="flex flex-col items-center gap-4 rounded-xl border bg-card py-10 text-center">
        <Icon className="text-muted-foreground size-7" />
        {/* The tab and the QR caption already name the pass (issue #297). */}
        <p className="text-muted-foreground text-sm">{t("walletScanHint")}</p>
        <QrCode
          value={value}
          label={purpose === "ticket" ? t("entranceTicket") : t("currentBadge")}
          className="border-none"
        />
      </div>

      <SectionCard title={t("walletAddPass")} description={t("walletAddPassHint")}>
        <WalletButtons purpose={purpose} />
      </SectionCard>
    </>
  );
}
