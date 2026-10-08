"use client";

import {
  WALLET_ARTWORK_DIMENSIONS,
  WALLET_ARTWORK_SLOTS,
  type WalletAlert,
  type WalletArtworkScale,
  type WalletArtworkSlot,
  type WalletSettings,
} from "@hackos/shared/wallet-settings";
import Image from "next/image";
import { useEffect, useId, useState } from "react";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api, apiUpload } from "@/lib/api";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { ApplePassOptions, GooglePassOptions } from "./wallet-guided-options";

const assetLabels: Record<WalletArtworkSlot, MessageKey> = {
  appleIcon: "walletAppleIcon",
  appleLogo: "walletAppleLogo",
  appleStrip: "walletAppleStrip",
  appleBackground: "walletAppleBackground",
  appleThumbnail: "walletAppleThumbnail",
  appleFooter: "walletAppleFooter",
  googleLogo: "walletGoogleLogo",
  googleWideLogo: "walletGoogleWideLogo",
  googleHero: "walletGoogleHero",
  googleDetail: "walletGoogleDetail",
};
interface Operation {
  id: string;
  total: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
}
const blankAlert: WalletAlert = {
  es: { title: "", body: "" },
  gl: { title: "", body: "" },
  en: { title: "", body: "" },
};
type OptionKey = "appleOptions" | "googleClassOptions" | "googleObjectOptions";
function parsedOptions(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function ArtworkSlotEditor({
  slot,
  settings,
  busy,
  onUpload,
  onReset,
}: {
  slot: WalletArtworkSlot;
  settings: WalletSettings;
  busy: boolean;
  onUpload: (
    slot: WalletArtworkSlot,
    files: Partial<Record<WalletArtworkScale, File>>,
  ) => Promise<boolean>;
  onReset: (slot: WalletArtworkSlot) => Promise<void>;
}) {
  const { t } = useLocale();
  const id = useId();
  const [selected, setSelected] = useState<Partial<Record<WalletArtworkScale, File>>>({});
  const [revision, setRevision] = useState(0);
  const custom = settings.artwork[slot];
  const preview = custom ?? settings.artworkDefaults?.[slot];
  const isApple = slot.startsWith("apple");
  const scales: WalletArtworkScale[] = isApple ? [1, 2, 3] : [1];
  const dimensions = WALLET_ARTWORK_DIMENSIONS[slot];
  async function apply() {
    if (!Object.keys(selected).length) return;
    if (await onUpload(slot, selected)) {
      setSelected({});
      setRevision((value) => value + 1);
    }
  }
  return (
    <div className="space-y-3 border-t border-border/60 pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{t(assetLabels[slot])}</p>
        <p className="text-muted-foreground text-xs">
          {custom
            ? t("walletArtworkCustom")
            : preview
              ? t(isApple ? "walletArtworkBundled" : "walletArtworkEnvironment")
              : t("walletArtworkMissing")}
        </p>
      </div>
      {preview && (
        <div className="flex flex-wrap gap-4">
          {scales.map((scale) => {
            const url = preview.variants?.[scale] ?? (scale === 1 ? preview.url : undefined);
            return url ? (
              <figure key={scale} className="space-y-1">
                <Image
                  unoptimized
                  width={dimensions.width * scale}
                  height={dimensions.height * scale}
                  src={url}
                  alt={`${t(assetLabels[slot])} ${scale}×`}
                  className="h-16 max-w-40 rounded-md border object-contain"
                />
                <figcaption className="text-muted-foreground text-xs">{scale}×</figcaption>
              </figure>
            ) : null;
          })}
        </div>
      )}
      <div className={isApple ? "grid items-start gap-3 sm:grid-cols-3" : "space-y-2"}>
        {scales.map((scale) => (
          <div key={`${revision}-${scale}`} className="min-w-0 space-y-1.5">
            <Label htmlFor={`${id}-${scale}`}>
              {t("walletArtworkScale", {
                scale,
                width: dimensions.width * scale,
                height: dimensions.height * scale,
              })}
            </Label>
            <Input
              id={`${id}-${scale}`}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (isApple) setSelected((value) => ({ ...value, [scale]: file }));
                else void onUpload(slot, { 1: file });
              }}
            />
          </div>
        ))}
      </div>
      {isApple && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy || !Object.keys(selected).length}
            onClick={() => void apply()}
          >
            {t("walletApplyArtwork")}
          </Button>
          <p className="text-muted-foreground self-center text-xs">
            {t("walletArtworkScaleMissing")}
          </p>
        </div>
      )}
      {custom && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void onReset(slot)}
        >
          {t("walletResetArtwork")}
        </Button>
      )}
    </div>
  );
}
export function WalletRuntimeEditor({
  registerSave,
  onDirtyChange,
  view,
  pending,
  onSave,
}: {
  pending: boolean;
  view: "fields" | "appearance" | "artwork" | "delivery";
  onSave: () => void;
  registerSave: (save: (() => Promise<void>) | null) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const [settings, setSettings] = useState<WalletSettings | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [optionText, setOptionText] = useState({
    appleOptions: "{}",
    googleClassOptions: "{}",
    googleObjectOptions: "{}",
  });
  const [alert, setAlert] = useState<WalletAlert>(blankAlert);
  const [confirm, setConfirm] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [reload, setReload] = useState(0);
  const options = {
    appleOptions: parsedOptions(optionText.appleOptions),
    googleClassOptions: parsedOptions(optionText.googleClassOptions),
    googleObjectOptions: parsedOptions(optionText.googleObjectOptions),
  };
  const changeOptions = (key: OptionKey, value: Record<string, unknown>) =>
    setOptionText((current) => ({ ...current, [key]: JSON.stringify(value, null, 2) }));
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is the explicit retry trigger.
  useEffect(() => {
    let active = true;
    void api
      .get<WalletSettings>("/api/event/wallet")
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setSavedSnapshot(JSON.stringify({ ...value, artwork: null, artworkDefaults: null }));
        setError(null);
        setOptionText({
          appleOptions: JSON.stringify(value.appleOptions, null, 2),
          googleClassOptions: JSON.stringify(value.googleClassOptions, null, 2),
          googleObjectOptions: JSON.stringify(value.googleObjectOptions, null, 2),
        });
      })
      .catch((err) => {
        if (active)
          setError(err instanceof ApiError ? err.message : t("couldNotLoadEventSettings"));
      });
    return () => {
      active = false;
    };
  }, [reload, t]);
  useEffect(() => {
    if (!operation?.queued) return;
    let active = true;
    const timer = setInterval(() => {
      void api
        .get<Operation>(`/api/event/wallet/operations/${operation.id}`)
        .then((value) => {
          if (active) setOperation(value);
        })
        .catch((err) => {
          if (active) {
            setError(err instanceof ApiError ? err.message : t("walletOperationError"));
          }
        });
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [operation?.id, operation?.queued, t]);
  const report = (err: unknown) =>
    toast.error(
      err instanceof ApiError ? err.message : t("walletOperationError"),
      t("toastWalletSettings"),
    );
  // H28: the Wallet category owns one Save; artwork and delivery retain their distinct lifecycle.
  useEffect(() => {
    const dirty =
      !!settings &&
      (JSON.stringify({ ...settings, artwork: null, artworkDefaults: null }) !== savedSnapshot ||
        optionText.appleOptions !== JSON.stringify(settings.appleOptions, null, 2) ||
        optionText.googleClassOptions !== JSON.stringify(settings.googleClassOptions, null, 2) ||
        optionText.googleObjectOptions !== JSON.stringify(settings.googleObjectOptions, null, 2));
    onDirtyChange(dirty);
    registerSave(
      settings
        ? async () => {
            const { artwork: _artwork, artworkDefaults: _defaults, ...body } = settings;
            const next = await api.put<WalletSettings>("/api/event/wallet", {
              ...body,
              appleOptions: JSON.parse(optionText.appleOptions),
              googleClassOptions: JSON.parse(optionText.googleClassOptions),
              googleObjectOptions: JSON.parse(optionText.googleObjectOptions),
            });
            setSettings(next);
            setSavedSnapshot(JSON.stringify({ ...next, artwork: null, artworkDefaults: null }));
          }
        : null,
    );
    return () => {
      registerSave(null);
      onDirtyChange(false);
    };
  }, [settings, savedSnapshot, optionText, registerSave, onDirtyChange]);
  async function restoreDefaults() {
    setBusy(true);
    try {
      const value = await api.delete<WalletSettings>("/api/event/wallet");
      setSettings(value);
      setSavedSnapshot(JSON.stringify({ ...value, artwork: null, artworkDefaults: null }));
      setOptionText({
        appleOptions: JSON.stringify(value.appleOptions, null, 2),
        googleClassOptions: JSON.stringify(value.googleClassOptions, null, 2),
        googleObjectOptions: JSON.stringify(value.googleObjectOptions, null, 2),
      });
      toast.success(t("saved"), { compactTitle: t("toastWalletSettings") });
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }
  async function upload(slot: WalletArtworkSlot, files: Partial<Record<WalletArtworkScale, File>>) {
    setBusy(true);
    try {
      const form = new FormData();
      for (const [scale, file] of Object.entries(files))
        form.append(Number(scale) === 1 ? "file" : `file${scale}x`, file);
      const next = await apiUpload<WalletSettings>(`/api/event/wallet/artwork/${slot}`, form);
      setSettings((value) => (value ? { ...value, artwork: next.artwork } : next));
      return true;
    } catch (err) {
      report(err);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function reset(slot: WalletArtworkSlot) {
    setBusy(true);
    try {
      const next = await api.delete<WalletSettings>(`/api/event/wallet/artwork/${slot}`);
      setSettings((value) => (value ? { ...value, artwork: next.artwork } : next));
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }
  async function send(kind: "refresh" | "alert") {
    setBusy(true);
    try {
      setOperation(
        await api.post<Operation>(
          "/api/event/wallet/operations",
          kind === "alert" ? { kind, translations: alert } : { kind },
        ),
      );
      setConfirm(false);
      toast.success(t("walletOperationQueued"), { compactTitle: t("toastWalletSettings") });
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }
  if (error && !settings)
    return (
      <div role="alert" className="space-y-3">
        <p>{error}</p>
        <Button onClick={() => setReload((value) => value + 1)}>{t("retry")}</Button>
      </div>
    );
  if (!settings) return <p role="status">{t("loading")}</p>;
  return (
    <fieldset disabled={pending} hidden={view === "fields"} className="space-y-8 pt-8">
      <TabsContent value="appearance" forceMount hidden={view !== "appearance"}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
          hidden={view !== "appearance"}
          className="space-y-8"
        >
          <button type="submit" hidden />
          <SectionCard title={t("walletAppearanceTitle")} variant="plain">
            <fieldset disabled={busy} className="space-y-6">
              <div className="space-y-2 sm:max-w-72">
                <Label htmlFor={`${id}-backgroundColor`}>{t("walletBackgroundColor")}</Label>
                <Input
                  id={`${id}-backgroundColor`}
                  type="color"
                  value={settings.backgroundColor}
                  onChange={(event) =>
                    setSettings({ ...settings, backgroundColor: event.target.value })
                  }
                />
              </div>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                {(
                  [
                    ["websiteUrl", "walletWebsiteUrl"],
                    ["scheduleUrl", "walletScheduleUrl"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-2">
                    <Label htmlFor={`${id}-${key}`}>{t(label)}</Label>
                    <Input
                      id={`${id}-${key}`}
                      value={settings[key]}
                      onChange={(event) => setSettings({ ...settings, [key]: event.target.value })}
                      required
                    />
                  </div>
                ))}
              </div>
              {(
                [
                  ["showDirections", "walletDirectionsAction"],
                  ["showSchedule", "walletScheduleAction"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <Label htmlFor={`${id}-${key}`}>{t(label)}</Label>
                  <Switch
                    id={`${id}-${key}`}
                    checked={settings[key]}
                    onCheckedChange={(value) => setSettings({ ...settings, [key]: value })}
                    disabled={busy}
                  />
                </div>
              ))}
            </fieldset>
          </SectionCard>
          <SectionCard title={t("walletAppleDetailsTitle")} variant="plain">
            <fieldset disabled={busy} className="space-y-6">
              <div className="grid items-start gap-4 sm:grid-cols-2">
                {(
                  [
                    ["foregroundColor", "walletForegroundColor"],
                    ["labelColor", "walletLabelColor"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-2">
                    <Label htmlFor={`${id}-${key}`}>{t(label)}</Label>
                    <Input
                      id={`${id}-${key}`}
                      type="color"
                      value={settings[key]}
                      onChange={(event) => setSettings({ ...settings, [key]: event.target.value })}
                    />
                  </div>
                ))}
                <div className="space-y-2">
                  <Label htmlFor={`${id}-store`}>{t("walletAppleAppStore")}</Label>
                  <Input
                    id={`${id}-store`}
                    type="number"
                    min="1"
                    value={settings.appleAppStoreId ?? ""}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        appleAppStoreId: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                  />
                </div>
              </div>
              <ApplePassOptions
                options={options.appleOptions}
                onChange={(value) => changeOptions("appleOptions", value)}
              />
            </fieldset>
            <details className="space-y-4">
              <summary className="cursor-pointer text-sm font-medium">
                {t("walletNativeOptions")}
              </summary>
              <p className="text-muted-foreground text-sm">{t("walletNativeOptionsHelp")}</p>
              <Label htmlFor={`${id}-appleOptions`}>{t("walletAppleOptions")}</Label>
              <Textarea
                id={`${id}-appleOptions`}
                value={optionText.appleOptions}
                onChange={(event) =>
                  setOptionText({ ...optionText, appleOptions: event.target.value })
                }
                className="min-h-40 font-mono text-sm"
                spellCheck={false}
              />
            </details>
          </SectionCard>
          <SectionCard title={t("walletGoogleDetailsTitle")} variant="plain">
            <fieldset disabled={busy} className="space-y-6">
              <div className="grid items-start gap-4 sm:grid-cols-2">
                {(
                  [
                    ["androidPackageName", "walletAndroidPackage"],
                    ["androidStoreUrl", "walletAndroidStore"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-2">
                    <Label htmlFor={`${id}-${key}`}>{t(label)}</Label>
                    <Input
                      id={`${id}-${key}`}
                      value={settings[key]}
                      onChange={(event) => setSettings({ ...settings, [key]: event.target.value })}
                      required
                    />
                  </div>
                ))}
              </div>
              <GooglePassOptions
                options={options.googleClassOptions}
                onChange={(value) => changeOptions("googleClassOptions", value)}
              />
            </fieldset>
            <details className="space-y-4">
              <summary className="cursor-pointer text-sm font-medium">
                {t("walletNativeOptions")}
              </summary>
              <p className="text-muted-foreground text-sm">{t("walletNativeOptionsHelp")}</p>
              {(
                [
                  ["googleClassOptions", "walletGoogleClassOptions"],
                  ["googleObjectOptions", "walletGoogleObjectOptions"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`${id}-${key}`}>{t(label)}</Label>
                  <Textarea
                    id={`${id}-${key}`}
                    value={optionText[key]}
                    onChange={(event) =>
                      setOptionText({ ...optionText, [key]: event.target.value })
                    }
                    className="min-h-40 font-mono text-sm"
                    spellCheck={false}
                  />
                </div>
              ))}
            </details>
          </SectionCard>
        </form>
        <div hidden={view !== "appearance"} className="space-y-3">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void restoreDefaults()}
          >
            {t("walletResetDefaults")}
          </Button>
        </div>
      </TabsContent>
      <TabsContent value="artwork" forceMount hidden={view !== "artwork"} className="space-y-8">
        <SectionCard title={t("walletAppleArtworkTitle")} variant="plain">
          <p className="text-muted-foreground text-sm">{t("walletArtworkAppleHelp")}</p>
          <div className="space-y-6">
            {WALLET_ARTWORK_SLOTS.filter((slot) => slot.startsWith("apple")).map((slot) => (
              <ArtworkSlotEditor
                key={slot}
                slot={slot}
                settings={settings}
                busy={busy}
                onUpload={upload}
                onReset={reset}
              />
            ))}
          </div>
        </SectionCard>
        <SectionCard title={t("walletGoogleArtworkTitle")} variant="plain">
          <p className="text-muted-foreground text-sm">{t("walletArtworkHelp")}</p>
          <div className="space-y-6">
            {WALLET_ARTWORK_SLOTS.filter((slot) => slot.startsWith("google")).map((slot) => (
              <ArtworkSlotEditor
                key={slot}
                slot={slot}
                settings={settings}
                busy={busy}
                onUpload={upload}
                onReset={reset}
              />
            ))}
          </div>
        </SectionCard>
      </TabsContent>
      <TabsContent value="delivery" forceMount hidden={view !== "delivery"}>
        <SectionCard title={t("walletDeliveryTitle")} variant="plain">
          <p className="text-muted-foreground text-sm">{t("walletDeliveryHelp")}</p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void send("refresh")}
          >
            {t("walletRefreshPasses")}
          </Button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setConfirm(true);
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {(["es", "gl", "en"] as const).map((language) => (
                <fieldset key={language} disabled={busy} className="space-y-3">
                  <legend className="mb-2 text-sm font-medium">{language.toUpperCase()}</legend>
                  <div className="space-y-2">
                    <Label htmlFor={`${id}-alert-title-${language}`}>{t("walletAlertTitle")}</Label>
                    <Input
                      id={`${id}-alert-title-${language}`}
                      required
                      maxLength={100}
                      value={alert[language].title}
                      onChange={(event) =>
                        setAlert({
                          ...alert,
                          [language]: { ...alert[language], title: event.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`${id}-alert-body-${language}`}>{t("walletAlertBody")}</Label>
                    <Textarea
                      id={`${id}-alert-body-${language}`}
                      required
                      maxLength={500}
                      value={alert[language].body}
                      onChange={(event) =>
                        setAlert({
                          ...alert,
                          [language]: { ...alert[language], body: event.target.value },
                        })
                      }
                    />
                  </div>
                </fieldset>
              ))}
            </div>
            <Button type="submit" disabled={busy}>
              {t("walletSendAlert")}
            </Button>
          </form>
          <div role="status" aria-live="polite" className="text-sm">
            {operation
              ? t("walletDeliveryCounts", {
                  sent: operation.sent,
                  total: operation.total,
                  queued: operation.queued,
                  failed: operation.failed,
                  skipped: operation.skipped,
                })
              : ""}
          </div>
          {error && <p role="alert">{error}</p>}
        </SectionCard>
      </TabsContent>
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("walletSendAlert")}</DialogTitle>
            <DialogDescription>{t("walletAlertConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
              {t("cancel")}
            </Button>
            <Button disabled={busy} onClick={() => void send("alert")}>
              {t("walletSendAlert")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </fieldset>
  );
}
