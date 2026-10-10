"use client";

// Sponsor stand tags (#935): NFC tag UIDs and printable QR tokens that
// attendees scan to save this sponsor in their event diary. Managed by the
// enterprise's own sponsor reps or staff with sponsors:manage.

import { EVENTS } from "@hackos/shared/events";
import { ContactlessPaymentIcon } from "@phosphor-icons/react/dist/csr/ContactlessPayment";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { QrCodeIcon } from "@phosphor-icons/react/dist/csr/QrCode";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useId, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api, apiDownload } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  normalizeUid,
  type StandTag,
  standQrSvgPath,
  standTagInUseKey,
  UID_PATTERN,
} from "@/lib/stands";
import { toast } from "@/lib/toast";

export type { StandTag };

function QrTag({
  tag,
  label,
  enterpriseId,
}: {
  tag: StandTag;
  label: string;
  enterpriseId: number;
}) {
  const { t } = useLocale();
  const [downloading, setDownloading] = useState(false);

  // The API renders the printable SVG (company name and token underneath),
  // the same file the staff Stands page and its zip export produce.
  async function download() {
    setDownloading(true);
    try {
      await apiDownload(standQrSvgPath(enterpriseId, tag.id), `${tag.code}.svg`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("standQrCouldNotDownload"),
        t("standTagDownloadQr"),
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0 rounded-md border bg-white p-1">
        <QRCodeSVG
          value={tag.code}
          title={`${label} QR`}
          level="Q"
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#000000"
          size={88}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={downloading}
        disabled={downloading}
        onClick={() => void download()}
      >
        <DownloadSimpleIcon aria-hidden="true" className="size-4" />
        {t("standTagDownloadQr")}
      </Button>
    </div>
  );
}

export function StandTagsCard({
  enterpriseId,
  enterpriseName,
  scannable,
  canManage = false,
  onScannableChange,
}: {
  enterpriseId: number;
  enterpriseName: string;
  /** Staff decide which stands attendees can collect (`stand_scannable`). */
  scannable: boolean;
  /** `sponsors:manage`: may turn scanning on from here. */
  canManage?: boolean;
  onScannableChange?: (scannable: boolean) => void;
}) {
  const { t, language } = useLocale();
  const uidId = useId();
  const [tags, setTags] = useState<StandTag[] | null>(null);
  const [uid, setUid] = useState("");
  const [uidError, setUidError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"nfc" | "qr" | "scannable" | number | null>(null);
  const [removing, setRemoving] = useState<StandTag | null>(null);

  async function enableScanning() {
    setBusy("scannable");
    try {
      await api.put(`/api/enterprises/${enterpriseId}/stand-scannable`, { scannable: true });
      onScannableChange?.(true);
      toast.success(t("standScanningOn"), { compactTitle: t("standScannable") });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("standCouldNotUpdateScannable"),
        t("standScannable"),
      );
    } finally {
      setBusy(null);
    }
  }

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ tags: StandTag[] }>(
        `/api/enterprises/${enterpriseId}/stand-tags`,
      );
      setTags(data.tags);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("standTagsCouldNotLoad"),
        t("standTags"),
      );
      setTags((current) => current ?? []);
    }
  }, [enterpriseId, t]);

  const liveRefresh = useAutoRefresh("/api/events/stream?topic=sponsors", [EVENTS.DOMAIN_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, liveRefresh]);

  async function add(body: { kind: "nfc"; uid: string } | { kind: "qr" }) {
    setBusy(body.kind);
    try {
      const tag = await api.post<StandTag>(`/api/enterprises/${enterpriseId}/stand-tags`, body);
      setTags((current) => [...(current ?? []), tag]);
      if (body.kind === "nfc") setUid("");
      toast.success(t("standTagAdded"), {
        compactTitle: body.kind === "nfc" ? t("standTagLinkNfc") : t("standTagGenerateQr"),
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("standTagCouldNotAdd");
      const inUse = body.kind === "nfc" ? standTagInUseKey(err) : null;
      if (inUse) {
        setUidError(t(inUse));
      } else {
        toast.error(message, body.kind === "nfc" ? t("standTagLinkNfc") : t("standTagGenerateQr"));
      }
    } finally {
      setBusy(null);
    }
  }

  function linkNfc(event: React.FormEvent) {
    event.preventDefault();
    const normalized = normalizeUid(uid);
    if (!UID_PATTERN.test(normalized)) {
      setUidError(t("standTagInvalidUid"));
      return;
    }
    void add({ kind: "nfc", uid: normalized });
  }

  async function confirmRemove() {
    if (!removing) return;
    const tag = removing;
    setBusy(tag.id);
    try {
      await api.delete(`/api/enterprises/${enterpriseId}/stand-tags/${tag.id}`);
      setTags((current) => (current ?? []).filter((item) => item.id !== tag.id));
      setRemoving(null);
      toast.success(t("standTagRemoved"), { compactTitle: t("standTagRemove") });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("standTagCouldNotRemove"),
        t("standTagRemove"),
      );
    } finally {
      setBusy(null);
    }
  }

  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: "medium" });

  return (
    <SectionCard>
      <div className="space-y-6">
        {!scannable && (
          <div
            role="status"
            className="bg-muted/50 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3"
          >
            <p className="text-muted-foreground text-sm">{t("standNotScannableNotice")}</p>
            {canManage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                loading={busy === "scannable"}
                onClick={() => void enableScanning()}
              >
                {t("standTurnOnScanning")}
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <form onSubmit={linkNfc} className="w-full max-w-md space-y-2" noValidate>
            <Label htmlFor={uidId}>{t("standTagUid")}</Label>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                id={uidId}
                value={uid}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                aria-invalid={uidError ? true : undefined}
                aria-describedby={uidError ? `${uidId}-error` : undefined}
                disabled={busy !== null}
                onChange={(event) => {
                  setUid(event.target.value);
                  setUidError(null);
                }}
              />
              <Button
                type="submit"
                size="lg"
                disabled={busy !== null || uid.trim() === ""}
                loading={busy === "nfc"}
              >
                {t("standTagLinkNfc")}
              </Button>
            </div>
            {uidError && (
              <p id={`${uidId}-error`} className="text-destructive text-sm">
                {uidError}
              </p>
            )}
          </form>
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={busy !== null}
            loading={busy === "qr"}
            onClick={() => void add({ kind: "qr" })}
          >
            <QrCodeIcon aria-hidden="true" className="size-4" />
            {t("standTagGenerateQr")}
          </Button>
        </div>

        {tags === null ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : tags.length === 0 ? (
          <EmptyState icon={ContactlessPaymentIcon} title={t("standTagsEmpty")} />
        ) : (
          <ul className="divide-border divide-y border-t">
            {tags.map((tag) => (
              <li key={tag.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
                  {tag.kind === "nfc" ? (
                    <ContactlessPaymentIcon
                      className="text-muted-foreground size-5 shrink-0"
                      aria-label={t("standTagNfc")}
                    />
                  ) : (
                    <QrCodeIcon
                      className="text-muted-foreground size-5 shrink-0"
                      aria-label={t("standTagQr")}
                    />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{tag.code}</p>
                    <p className="text-muted-foreground text-xs">
                      {dateFormat.format(new Date(tag.createdAt))}
                    </p>
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-3">
                  {tag.kind === "qr" && (
                    <QrTag tag={tag} label={enterpriseName} enterpriseId={enterpriseId} />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => setRemoving(tag)}
                  >
                    {t("remove")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AlertModal
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("standTagRemove")}
        description={removing?.kind === "qr" ? t("standTagRemoveQrDesc") : (removing?.code ?? "")}
        cancelLabel={t("cancel")}
        confirmLabel={t("remove")}
        destructive
        pending={removing !== null && busy === removing.id}
        onConfirm={confirmRemove}
      />
    </SectionCard>
  );
}
