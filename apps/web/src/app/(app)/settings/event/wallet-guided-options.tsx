"use client";

import type { WalletSettings } from "@hackos/shared/wallet-settings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLocale } from "@/lib/i18n";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function ApplePassOptions({
  options,
  onChange,
}: {
  options: WalletSettings["appleOptions"];
  onChange: (value: Record<string, unknown>) => void;
}) {
  const { t } = useLocale();
  function set(key: string, value: unknown) {
    const next = { ...options };
    if (value === "" || value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  }
  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="wallet-apple-description">{t("walletAppleDescription")}</Label>
          <Input
            id="wallet-apple-description"
            value={text(options.description)}
            onChange={(event) => set("description", event.target.value)}
            placeholder={t("walletAppleDescriptionDefault")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wallet-apple-logo-text">{t("walletAppleLogoText")}</Label>
          <Input
            id="wallet-apple-logo-text"
            value={text(options.logoText)}
            onChange={(event) => set("logoText", event.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="wallet-apple-sharing">{t("walletAppleSharing")}</Label>
        <Switch
          id="wallet-apple-sharing"
          checked={options.sharingProhibited !== false}
          onCheckedChange={(checked) => set("sharingProhibited", checked)}
        />
      </div>
    </div>
  );
}

export function GooglePassOptions({
  options,
  onChange,
}: {
  options: WalletSettings["googleClassOptions"];
  onChange: (value: Record<string, unknown>) => void;
}) {
  const { t } = useLocale();
  function set(key: string, value: unknown) {
    const next = { ...options };
    if (value === "") delete next[key];
    else next[key] = value;
    onChange(next);
  }
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="wallet-google-issuer">{t("walletGoogleIssuer")}</Label>
        <Input
          id="wallet-google-issuer"
          value={text(options.issuerName)}
          onChange={(event) => set("issuerName", event.target.value)}
          placeholder={t("walletGoogleIssuerDefault")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="wallet-google-country">{t("walletGoogleCountry")}</Label>
        <Input
          id="wallet-google-country"
          value={text(options.countryCode)}
          onChange={(event) => set("countryCode", event.target.value.toUpperCase())}
          maxLength={2}
          placeholder="ES"
        />
      </div>
    </div>
  );
}
