"use client";

// Accreditation QR / badge (H22-H23, H28).

import { QrCodeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { QrCode } from "@/components/common/qr-code";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type TicketQrPayload } from "@/lib/logistics";
import type { UserDetail } from "@/lib/types";

export function QrTab({ user }: { user: UserDetail }) {
  const { t } = useLocale();
  const [payload, setPayload] = useState<TicketQrPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    logisticsApi
      .userTicket(user.id)
      .then((data) => {
        if (alive) setPayload(data);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : t("couldNotLoadQrPayloads"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user.id, t]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (error) {
    return <EmptyState icon={QrCodeIcon} title={t("couldNotLoadQrCodes")} description={error} />;
  }

  return (
    <SectionCard
      title={t("ticketAndBadgeQr")}
      description={t("ticketAndBadgeQrDesc")}
      icon={QrCodeIcon}
      bodyClassName="grid gap-4 md:grid-cols-2"
    >
      <QrCode value={payload?.ticketToken} label={t("entranceTicket")} />
      <QrCode value={payload?.badgeId} label={t("currentBadge")} />
    </SectionCard>
  );
}
