"use client";

import { IdCardIcon, TicketIcon, WalletCardsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { QrCode } from "@/components/common/qr-code";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type TicketQrPayload } from "@/lib/logistics";
import { useMe } from "@/lib/session";

/**
 * Apple only ships this badge for "es" and "en_US/en_GB" locales; "gl" falls
 * back to the Spanish artwork since there's no Galician variant and the two
 * languages share readers. Per Apple's Add to Apple Wallet guidelines, this
 * must be the unmodified official artwork (no recoloring, no custom button)
 * shown on a light background.
 */
const APPLE_WALLET_BADGE_BY_LOCALE: Record<string, string> = {
  es: "/wallet-badges/apple-wallet-badge-es.svg",
  gl: "/wallet-badges/apple-wallet-badge-es.svg",
  en: "/wallet-badges/apple-wallet-badge-en.svg",
};

/**
 * Same fallback logic as the Apple badge above, using Google's official
 * es-ES/en-US "primary" button artwork. Per Google's Add to Google Wallet
 * brand guidelines, this must be the unmodified official asset (no
 * recoloring, no custom button, no free-scaling of the aspect ratio).
 */
const GOOGLE_WALLET_BUTTON_BY_LOCALE: Record<string, string> = {
  es: "/wallet-badges/google-wallet-button-es.svg",
  gl: "/wallet-badges/google-wallet-button-es.svg",
  en: "/wallet-badges/google-wallet-button-en.svg",
};

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
  const { t, language } = useLocale();
  const appleBadgeSrc = APPLE_WALLET_BADGE_BY_LOCALE[language] ?? APPLE_WALLET_BADGE_BY_LOCALE.en;
  const googleButtonSrc =
    GOOGLE_WALLET_BUTTON_BY_LOCALE[language] ?? GOOGLE_WALLET_BUTTON_BY_LOCALE.en;
  const [googleLoading, setGoogleLoading] = useState(false);

  async function openGoogleWallet() {
    setGoogleLoading(true);
    try {
      const { saveUrl } = await logisticsApi.googleWalletSaveUrl(purpose);
      window.open(saveUrl, "_blank");
    } catch {
      toast.error(t("walletGoogleSaveFailed"));
    } finally {
      setGoogleLoading(false);
    }
  }

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
      <div className="flex flex-wrap items-center gap-3">
        {/*
          Apple's Add to Apple Wallet guidelines require the unmodified
          official badge artwork (no custom button, no recoloring) shown on
          a light background, kept secondary to the surrounding content.
        */}
        <button
          type="button"
          className="inline-flex w-fit rounded-md bg-white p-1.5 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={() => window.open(`${API_URL}/api/me/wallet/apple/${purpose}.pkpass`, "_blank")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- official Apple badge, must not be re-processed by next/image */}
          {/* biome-ignore lint/performance/noImgElement: official Apple badge, must not be re-processed by next/image */}
          <img src={appleBadgeSrc} alt={t("addToAppleWallet")} className="h-12 w-auto" />
        </button>

        {/*
          Google's Add to Google Wallet brand guidelines require the
          unmodified official button asset (min 48dp tall, no recoloring, no
          custom button) and that it call a real Google Wallet save flow.
        */}
        <button
          type="button"
          className="inline-flex w-fit rounded-md disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || googleLoading}
          onClick={() => void openGoogleWallet()}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- official Google button, must not be re-processed by next/image */}
          {/* biome-ignore lint/performance/noImgElement: official Google button, must not be re-processed by next/image */}
          <img src={googleButtonSrc} alt={t("addToGoogleWallet")} className="h-12 w-auto" />
        </button>
      </div>
    </SectionCard>
  );
}
