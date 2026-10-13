"use client";

// Company tags (#935): NFC tags or wristbands (by serial number) and printable
// QR codes that attendees scan to collect this company in their event diary.
// Staff with sponsors:manage define them; the company's own reps only see
// them. Tags belong to the company, never to a rep's profile.

import { EVENTS } from "@hackos/shared/events";
import { ContactlessPaymentIcon } from "@phosphor-icons/react/dist/csr/ContactlessPayment";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { QrCodeIcon } from "@phosphor-icons/react/dist/csr/QrCode";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useId, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { EmptyState } from "@/components/common/empty-state";
import { IconButton } from "@/components/common/icon-button";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { api, apiDownload } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import {
  LABEL_MAX,
  normalizeUid,
  type StandTag,
  standQrSvgPath,
  standTagInUseKey,
  UID_PATTERN,
} from "@/lib/stands";
import { toast } from "@/lib/toast";

export type { StandTag };

/** The tag link the printed QR holds (the API's `companyTagUrl` on this web host). */
function companyTagLink(code: string): string {
  return `${window.location.origin}/s/${encodeURIComponent(code)}`;
}

function TagLabelDialog({
  enterpriseId,
  tag,
  onOpenChange,
  onSaved,
}: {
  enterpriseId: number;
  tag: StandTag | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (tag: StandTag) => void;
}) {
  const { t } = useLocale();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (tag) setValue(tag.label ?? "");
  }, [tag]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!tag) return;
    setPending(true);
    try {
      const saved = await api.patch<StandTag>(
        `/api/enterprises/${enterpriseId}/stand-tags/${tag.id}`,
        { label: value.trim() || null },
      );
      toast.success(t("standTagLabelSaved"), { compactTitle: t("standTagEditLabel") });
      onSaved(saved);
    } catch (err) {
      toast.error(apiErrorText(err, t, t("standTagCouldNotSaveLabel")), t("standTagEditLabel"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={tag !== null}
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open);
      }}
      title={t("standTagEditLabel")}
      size="sm"
      footer={
        <SubmitButton form="tag-label-form" pending={pending}>
          {t("save")}
        </SubmitButton>
      }
    >
      <form id="tag-label-form" onSubmit={submit} noValidate className="space-y-2 pb-1">
        <Label htmlFor={inputId}>{t("standTagLabel")}</Label>
        <Input
          id={inputId}
          value={value}
          maxLength={LABEL_MAX}
          autoComplete="off"
          autoFocus
          placeholder="Lanyard Ana"
          disabled={pending}
          onChange={(event) => setValue(event.target.value)}
        />
        {tag && <p className="text-muted-foreground font-mono text-xs">{tag.code}</p>}
      </form>
    </Modal>
  );
}

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
      toast.error(apiErrorText(err, t, t("standQrCouldNotDownload")), t("standTagDownloadQr"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0 rounded-md border bg-white p-1">
        <QRCodeSVG
          value={companyTagLink(tag.code)}
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
  /** `sponsors:manage`: defines the tags and may turn scanning on from here. */
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
  const [labelling, setLabelling] = useState<StandTag | null>(null);
  const copy = useCopyToClipboard({ title: "standTagCopyCode", failure: "standTagCouldNotCopy" });

  async function enableScanning() {
    setBusy("scannable");
    try {
      await api.put(`/api/enterprises/${enterpriseId}/stand-scannable`, { scannable: true });
      onScannableChange?.(true);
      toast.success(t("standScanningOn"), { compactTitle: t("standScannable") });
    } catch (err) {
      toast.error(apiErrorText(err, t, t("standCouldNotUpdateScannable")), t("standScannable"));
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
      toast.error(apiErrorText(err, t, t("standTagsCouldNotLoad")), t("standTags"));
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
      const message = apiErrorText(err, t, t("standTagCouldNotAdd"));
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
      toast.error(apiErrorText(err, t, t("standTagCouldNotRemove")), t("standTagRemove"));
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
        {canManage && (
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
        )}

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
                <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
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
                    {tag.label && <p className="truncate text-sm font-medium">{tag.label}</p>}
                    <div className="flex min-w-0 items-center gap-1">
                      <p className="truncate font-mono text-sm">{tag.code}</p>
                      <IconButton
                        variant="ghost"
                        size="icon-sm"
                        className="size-7"
                        label={t("standTagCopyCodeOf", { code: tag.label ?? tag.code })}
                        onClick={() => void copy(tag.code)}
                      >
                        <CopyIcon aria-hidden="true" className="size-3.5" />
                      </IconButton>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {dateFormat.format(new Date(tag.createdAt))}
                    </p>
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {tag.kind === "qr" && (
                    <QrTag tag={tag} label={enterpriseName} enterpriseId={enterpriseId} />
                  )}
                  {canManage && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => setLabelling(tag)}
                      >
                        {t("standTagEditLabel")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => setRemoving(tag)}
                      >
                        {t("remove")}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <TagLabelDialog
        enterpriseId={enterpriseId}
        tag={labelling}
        onOpenChange={(open) => {
          if (!open) setLabelling(null);
        }}
        onSaved={(saved) => {
          setTags((current) =>
            (current ?? []).map((item) => (item.id === saved.id ? saved : item)),
          );
          setLabelling(null);
        }}
      />
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
