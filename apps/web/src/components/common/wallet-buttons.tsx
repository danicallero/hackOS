"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { logisticsApi } from "@/lib/logistics";

/**
 * Apple only ships this badge for "es" and "en_US/en_GB" locales; "gl" falls
 * back to the Spanish artwork since there's no Galician variant and the two
 * languages share readers.
 */
const APPLE_WALLET_BADGE_BY_LOCALE: Record<string, string> = {
  es: "/wallet-badges/apple-wallet-badge-es.svg",
  gl: "/wallet-badges/apple-wallet-badge-es.svg",
  en: "/wallet-badges/apple-wallet-badge-en.svg",
};

/**
 * Same fallback logic as the Apple badge above.
 */
const GOOGLE_WALLET_BUTTON_BY_LOCALE: Record<string, string> = {
  es: "/wallet-badges/google-wallet-button-es.svg",
  gl: "/wallet-badges/google-wallet-button-es.svg",
  en: "/wallet-badges/google-wallet-button-en.svg",
};

export type WalletPurpose = "ticket" | "badge";

interface WalletButtonsProps {
  purpose: WalletPurpose;
  /**
   * Scoped wallet token from the acceptance-email confirm (issue #369). When
   * present the buttons hit the session-less /api/wallet/scoped/* routes and
   * send no cookies, so the pass is the token holder's, not whoever happens
   * to be signed in on this browser. Omit it for the signed-in wallet page.
   */
  accessToken?: string;
}

/**
 * The pair of official "Add to Wallet" buttons.
 */
export function WalletButtons({ purpose, accessToken }: WalletButtonsProps) {
  const { t, language } = useLocale();
  const appleBadgeSrc = APPLE_WALLET_BADGE_BY_LOCALE[language] ?? APPLE_WALLET_BADGE_BY_LOCALE.en;
  const googleButtonSrc =
    GOOGLE_WALLET_BUTTON_BY_LOCALE[language] ?? GOOGLE_WALLET_BUTTON_BY_LOCALE.en;
  const [googleLoading, setGoogleLoading] = useState(false);

  const appleHref = accessToken
    ? `${API_URL}/api/wallet/scoped/apple/${purpose}.pkpass?token=${encodeURIComponent(accessToken)}`
    : `${API_URL}/api/me/wallet/apple/${purpose}.pkpass`;

  async function openGoogleWallet() {
    setGoogleLoading(true);
    try {
      const { saveUrl } = accessToken
        ? await scopedGoogleSaveUrl(purpose, accessToken)
        : await logisticsApi.googleWalletSaveUrl(purpose);
      window.open(saveUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error(t("walletGoogleSaveFailed"));
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a href={appleHref} className="inline-flex w-fit">
        {/* biome-ignore lint/performance/noImgElement: official Apple badge, must not be re-processed by next/image */}
        <img src={appleBadgeSrc} alt={t("addToAppleWallet")} className="h-12 w-auto" />
      </a>

      <button
        type="button"
        className="inline-flex w-fit rounded-md disabled:cursor-not-allowed disabled:opacity-50"
        disabled={googleLoading}
        onClick={() => void openGoogleWallet()}
      >
        {/* biome-ignore lint/performance/noImgElement: official Google button, must not be re-processed by next/image */}
        {/* eslint-disable-next-line @next/next/no-img-element -- official Google button, must not be re-processed by next/image */}
        <img src={googleButtonSrc} alt={t("addToGoogleWallet")} className="h-12 w-auto" />
      </button>
    </div>
  );
}

/** Bypasses the shared api client — no session cookie should go out with a scoped token (issue #369). */
async function scopedGoogleSaveUrl(
  purpose: WalletPurpose,
  token: string,
): Promise<{ saveUrl: string }> {
  const res = await fetch(
    `${API_URL}/api/wallet/scoped/google/${purpose}?token=${encodeURIComponent(token)}`,
    { credentials: "omit" },
  );
  if (!res.ok) throw new ApiError(res.status, "wallet_scope_failed", "Wallet link unavailable");
  return res.json() as Promise<{ saveUrl: string }>;
}
