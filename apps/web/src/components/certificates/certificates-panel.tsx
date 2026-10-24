"use client";

import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { SealCheckIcon } from "@phosphor-icons/react/dist/csr/SealCheck";
import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorText } from "@/lib/api-error-text";
import {
  CERTIFICATE_VARIANTS,
  type Certificate,
  type CertificateOverview,
  type CertificateVariant,
  certificatesApi,
} from "@/lib/certificates";
import { LANGS, LOCALE_CODES, languageName, type MessageKey, useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { Language } from "@/lib/types";

const VARIANT_LABEL: Record<CertificateVariant, MessageKey> = {
  participation: "certificateVariantParticipation",
  hours: "certificateVariantHours",
  activities: "certificateVariantActivities",
};

/**
 * #1083: attendance certificates. `self` is the participant's own list;
 * `staff` is one person's, with issue, revoke and downloads
 * with and without the CSV footer.
 */
export function CertificatesPanel({ staffUserId }: { staffUserId?: number }) {
  const { t, language } = useLocale();
  const staff = staffUserId !== undefined;
  const [data, setData] = useState<CertificateOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variant, setVariant] = useState<CertificateVariant>("participation");
  const [locale, setLocale] = useState<Language>(language);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [revoking, setRevoking] = useState<Certificate | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const load = useCallback(async () => {
    try {
      setData(staff ? await certificatesApi.ofUser(staffUserId) : await certificatesApi.mine());
      setError(null);
    } catch (err) {
      setError(apiErrorText(err, t, t("couldNotLoadCertificates")));
    }
  }, [staff, staffUserId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, done?: string) {
    setPending(true);
    try {
      await action();
      if (done) toast.success(done, { compactTitle: t("toastCertificate") });
      await load();
    } catch (err) {
      toast.error(apiErrorText(err, t, t("couldNotUseCertificate")), t("toastCertificate"));
    } finally {
      setPending(false);
    }
  }

  if (error) return <ContextualError message={error} onRetry={() => void load()} />;
  if (!data) {
    return (
      <div className="flex justify-center py-10" role="status">
        <Spinner className="size-6" />
      </div>
    );
  }

  const below = staff && !data.eligibility.eligible;
  const dateFormat = new Intl.DateTimeFormat(LOCALE_CODES[language], { dateStyle: "medium" });

  return (
    <div className="space-y-6">
      <SectionCard title={t("certificates")} icon={SealCheckIcon}>
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Select value={variant} onValueChange={(v) => setVariant(v as CertificateVariant)}>
              <SelectTrigger aria-label={t("certificates")} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CERTIFICATE_VARIANTS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(VARIANT_LABEL[v])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Select value={locale} onValueChange={(v) => setLocale(v as Language)}>
              <SelectTrigger aria-label={t("language")} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {languageName(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SubmitButton
            pending={pending}
            disabled={below && !reason.trim()}
            onClick={() =>
              void run(
                () =>
                  staff
                    ? certificatesApi.issueFor(staffUserId, variant, locale, reason.trim())
                    : certificatesApi.issueMine(variant, locale),
                t("certificateIssuedToast"),
              )
            }
          >
            {staff ? t("certificateIssueAction") : t("certificateGet")}
          </SubmitButton>
        </div>
        {staff ? (
          <p className="text-muted-foreground mt-3 text-sm">
            {t("certificateHoursSoFar", { hours: String(data.eligibility.hours) })}
          </p>
        ) : null}
        {below ? (
          <div className="mt-3 space-y-2">
            <Label htmlFor="certificate-override">{t("certificateOverrideReason")}</Label>
            <Input
              id="certificate-override"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        ) : null}
      </SectionCard>

      {data.certificates.length === 0 ? (
        <EmptyState icon={SealCheckIcon} title={t("certificatesNone")} />
      ) : (
        <ul className="divide-border divide-y rounded-lg border">
          {data.certificates.map((cert) => (
            <li
              key={cert.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t(VARIANT_LABEL[cert.variant])}</span>
                <span className="text-muted-foreground text-sm">
                  {cert.locale.toUpperCase()} · {dateFormat.format(new Date(cert.issuedAt))}
                </span>
                {cert.revokedAt ? (
                  <StatusBadge tone="danger">{t("certificateRevoked")}</StatusBadge>
                ) : null}
              </div>
              {cert.revokedAt ? null : (
                <div className="flex flex-wrap gap-2">
                  {staff ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => void run(() => certificatesApi.download(cert.id, false))}
                      >
                        <DownloadSimpleIcon />
                        {t("certificateDownloadNoCsv")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => void run(() => certificatesApi.download(cert.id, true))}
                      >
                        <DownloadSimpleIcon />
                        {t("certificateDownloadCopy")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          setRevokeReason("");
                          setRevoking(cert);
                        }}
                      >
                        {t("certificateRevoke")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => void run(() => certificatesApi.downloadMine(cert.id))}
                    >
                      <DownloadSimpleIcon />
                      {t("certificateDownload")}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {staff ? (
        <>
          <Modal
            open={revoking !== null}
            onOpenChange={(open) => !open && setRevoking(null)}
            title={t("certificateRevokeTitle")}
            footer={
              <>
                <Button variant="outline" onClick={() => setRevoking(null)}>
                  {t("cancel")}
                </Button>
                <SubmitButton
                  pending={pending}
                  disabled={!revokeReason.trim()}
                  onClick={() => {
                    const target = revoking;
                    if (!target) return;
                    setRevoking(null);
                    void run(
                      () => certificatesApi.revoke(target.id, revokeReason.trim()),
                      t("certificateRevokedToast"),
                    );
                  }}
                >
                  {t("certificateRevoke")}
                </SubmitButton>
              </>
            }
          >
            <div className="space-y-2">
              <Label htmlFor="certificate-revoke-reason">{t("reasonLabel")}</Label>
              <Input
                id="certificate-revoke-reason"
                value={revokeReason}
                maxLength={500}
                onChange={(e) => setRevokeReason(e.target.value)}
              />
            </div>
          </Modal>
        </>
      ) : null}
    </div>
  );
}
