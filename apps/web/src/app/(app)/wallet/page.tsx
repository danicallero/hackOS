"use client";

import { IdCardIcon, TicketIcon, UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { QrCode } from "@/components/common/qr-code";
import { SectionCard } from "@/components/common/section-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API_URL } from "@/lib/env";
import { type Translate, useLocale } from "@/lib/i18n";
import { logisticsApi, type TicketQrPayload } from "@/lib/logistics";
import { useMe } from "@/lib/session";
import type { Me } from "@/lib/types";

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

type Purpose = "ticket" | "badge";

export default function WalletPage() {
  const me = useMe();
  const { t } = useLocale();
  const [payload, setPayload] = useState<TicketQrPayload | null>(null);
  const [purpose, setPurpose] = useState<Purpose>("ticket");

  useEffect(() => {
    logisticsApi
      .myTicket()
      .then(setPayload)
      .catch(() => setPayload(null));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title={t("wallet")} />

      <Tabs value={purpose} onValueChange={(value) => setPurpose(value as Purpose)}>
        <TabsList>
          <TabsTrigger value="ticket">{t("entranceTicket")}</TabsTrigger>
          <TabsTrigger value="badge">{t("badge")}</TabsTrigger>
        </TabsList>
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
            <Field label={t("walletHolderRole")} value={roleLabel(t)[me.role]} />
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

function roleLabel(t: Translate): Record<Me["role"], string> {
  return {
    admin: t("roleAdmin"),
    judge: t("roleJudge"),
    sponsor: t("roleSponsor"),
    staff: t("roleStaff"),
    participant: t("roleParticipant"),
  };
}

function WalletPurposePanel({ purpose, value }: { purpose: Purpose; value?: string | null }) {
  const { t } = useLocale();
  const icon = purpose === "ticket" ? TicketIcon : IdCardIcon;
  const label = purpose === "ticket" ? t("entranceTicket") : t("badge");

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
        <div className="space-y-1">
          <p className="text-xl font-semibold">{label}</p>
          <p className="text-muted-foreground text-sm">{t("walletScanHint")}</p>
        </div>
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

function WalletButtons({ purpose }: { purpose: Purpose }) {
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
    <div className="flex flex-wrap items-center gap-3">
      {/*
        Apple's Add to Apple Wallet guidelines require the unmodified
        official badge artwork (no custom button, no recoloring) shown on a
        light background, kept secondary to the surrounding content.
      */}
      <button
        type="button"
        className="inline-flex w-fit rounded-md bg-white p-1.5"
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
        disabled={googleLoading}
        onClick={() => void openGoogleWallet()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- official Google button, must not be re-processed by next/image */}
        {/* biome-ignore lint/performance/noImgElement: official Google button, must not be re-processed by next/image */}
        <img src={googleButtonSrc} alt={t("addToGoogleWallet")} className="h-12 w-auto" />
      </button>
    </div>
  );
}
