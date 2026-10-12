"use client";

import { ContactlessPaymentIcon } from "@phosphor-icons/react/dist/csr/ContactlessPayment";
import { useEffect, useId, useState } from "react";
import { Modal } from "@/components/common/modal";
import { SubmitButton } from "@/components/common/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  LABEL_MAX,
  normalizeUid,
  type StandSummary,
  type StandTag,
  standTagInUseKey,
  UID_PATTERN,
} from "@/lib/stands";
import { toast } from "@/lib/toast";

/**
 * Link an NFC tag or wristband to a company by typing its serial number, the
 * UID (#935), with an optional staff label. Validated like badges: separators
 * are dropped, hex is uppercased and must be 7 bytes. A wristband that is or
 * was a badge, or a tag of another company, stays in the dialog with an
 * inline error.
 */
export function LinkNfcDialog({
  stand,
  onOpenChange,
  onLinked,
}: {
  stand: StandSummary | null;
  onOpenChange: (open: boolean) => void;
  onLinked: (stand: StandSummary, tag: StandTag) => void;
}) {
  const { t } = useLocale();
  const inputId = useId();
  const labelId = useId();
  const [uid, setUid] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (stand) {
      setUid("");
      setLabel("");
      setError(null);
    }
  }, [stand]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!stand) return;
    const normalized = normalizeUid(uid);
    if (!UID_PATTERN.test(normalized)) {
      setError(t("standTagInvalidUid"));
      return;
    }
    setPending(true);
    try {
      const tag = await api.post<StandTag>(`/api/enterprises/${stand.enterpriseId}/stand-tags`, {
        kind: "nfc",
        uid: normalized,
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      toast.success(t("standNfcLinked", { name: stand.name }), {
        compactTitle: t("standTagLinkNfc"),
      });
      onLinked(stand, tag);
    } catch (err) {
      const inUse = standTagInUseKey(err);
      if (inUse) setError(t(inUse));
      else
        toast.error(
          err instanceof ApiError ? err.message : t("standTagCouldNotAdd"),
          t("standTagLinkNfc"),
        );
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={stand !== null}
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open);
      }}
      icon={ContactlessPaymentIcon}
      title={stand ? t("standLinkNfcTo", { name: stand.name }) : t("standTagLinkNfc")}
      size="sm"
      footer={
        <SubmitButton form="link-nfc-form" pending={pending} disabled={uid.trim() === ""}>
          {t("standTagLinkNfc")}
        </SubmitButton>
      }
    >
      <form id="link-nfc-form" onSubmit={submit} noValidate className="space-y-4 pb-1">
        <div className="space-y-2">
          <Label htmlFor={inputId}>{t("standTagUid")}</Label>
          <Input
            id={inputId}
            value={uid}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            placeholder="04A1B2C3D4E5F6"
            className="font-mono"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            disabled={pending}
            onChange={(event) => {
              setUid(event.target.value);
              setError(null);
            }}
          />
          {error && (
            <p id={`${inputId}-error`} className="text-destructive text-sm">
              {error}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor={labelId}>{t("standTagLabel")}</Label>
          <Input
            id={labelId}
            value={label}
            maxLength={LABEL_MAX}
            autoComplete="off"
            placeholder="Lanyard Ana"
            disabled={pending}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
      </form>
    </Modal>
  );
}
