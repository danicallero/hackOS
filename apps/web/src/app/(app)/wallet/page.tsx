"use client";

import { DownloadIcon, IdCardIcon, TicketIcon, WalletCardsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { QrCode } from "@/components/common/qr-code";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type TicketQrPayload } from "@/lib/logistics";
import { useMe } from "@/lib/session";

export default function WalletPage() {
  const me = useMe();
  const { t } = useLocale();
  const [payload, setPayload] = useState<TicketQrPayload | null>(null);

  useEffect(() => {
    logisticsApi
      .myTicket()
      .then(setPayload)
      .catch(() => setPayload(null));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title={t("wallet")} />

      <div className="grid gap-4 md:grid-cols-2">
        <WalletPassCard
          icon={TicketIcon}
          title={t("entranceTicket")}
          purpose="ticket"
          status={t("availableAfterConfirmation")}
        />
        <WalletPassCard
          icon={IdCardIcon}
          title={t("badge")}
          purpose="badge"
          status={me?.badgeId ? `${t("badge")} ${me.badgeId}` : t("badgeNotAssigned")}
          disabled={!me?.badgeId}
        />
      </div>

      <SectionCard
        title={t("qrCodes")}
        icon={WalletCardsIcon}
        bodyClassName="grid gap-4 md:grid-cols-2"
      >
        <QrCode value={payload?.ticketToken} label={t("entranceTicket")} />
        <QrCode value={payload?.badgeId} label={t("currentBadge")} />
      </SectionCard>
    </div>
  );
}

function WalletPassCard({
  icon,
  title,
  description,
  purpose,
  status,
  disabled,
}: {
  icon: typeof TicketIcon;
  title: string;
  description?: string;
  purpose: "ticket" | "badge";
  status: string;
  disabled?: boolean;
}) {
  const Icon = icon;
  const { t } = useLocale();
  return (
    <SectionCard
      title={title}
      description={description}
      icon={Icon}
      action={
        <StatusBadge tone={disabled ? "neutral" : "success"} dot={false}>
          {status}
        </StatusBadge>
      }
    >
      <Button
        className="w-full sm:w-auto"
        disabled={disabled}
        onClick={() => window.open(`${API_URL}/api/me/wallet/apple/${purpose}.pkpass`, "_blank")}
      >
        <DownloadIcon className="size-4" />
        {t("addToAppleWallet")}
      </Button>
    </SectionCard>
  );
}
