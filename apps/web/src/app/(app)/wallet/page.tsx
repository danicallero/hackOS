"use client";

import { DownloadIcon, IdCardIcon, TicketIcon, type WalletCardsIcon } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/env";
import { useMe } from "@/lib/session";

export default function WalletPage() {
  const me = useMe();

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
  icon: typeof WalletCardsIcon;
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
