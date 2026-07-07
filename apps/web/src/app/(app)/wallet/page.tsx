"use client";

import { DownloadIcon, IdCardIcon, TicketIcon, WalletCardsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { QrCode } from "@/components/common/qr-code";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/env";
import { logisticsApi, type TicketQrPayload } from "@/lib/logistics";
import { useMe } from "@/lib/session";

export default function WalletPage() {
  const me = useMe();
  const [payload, setPayload] = useState<TicketQrPayload | null>(null);

  useEffect(() => {
    logisticsApi
      .myTicket()
      .then(setPayload)
      .catch(() => setPayload(null));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wallet"
        description="Carry your entrance ticket and active badge in Apple Wallet."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <WalletPassCard
          icon={TicketIcon}
          title="Entrance ticket"
          description="Your ticket QR is permanent once your place is confirmed."
          purpose="ticket"
          status="Available after confirmation"
        />
        <WalletPassCard
          icon={IdCardIcon}
          title="Badge"
          description="Your badge pass follows your current physical badge and old passes are voided after rotation."
          purpose="badge"
          status={me?.badgeId ? `Badge ${me.badgeId}` : "Badge not assigned"}
          disabled={!me?.badgeId}
        />
      </div>

      <SectionCard
        title="QR codes"
        description="Use these directly when you do not want to add a mobile pass."
        icon={WalletCardsIcon}
        bodyClassName="grid gap-4 md:grid-cols-2"
      >
        <QrCode value={payload?.ticketToken} label="Entrance ticket" />
        <QrCode value={payload?.badgeId} label="Current badge" />
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
  description: string;
  purpose: "ticket" | "badge";
  status: string;
  disabled?: boolean;
}) {
  const Icon = icon;
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
        Add to Apple Wallet
      </Button>
    </SectionCard>
  );
}
