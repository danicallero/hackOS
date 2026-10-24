"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { SealCheckIcon } from "@phosphor-icons/react/dist/csr/SealCheck";
import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { IconButton } from "@/components/common/icon-button";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  type Certificate,
  type CertificateOverview,
  type CertificateType,
  certificatesApi,
  certificateTypesApi,
} from "@/lib/certificates";
import { LANGS, LOCALE_CODES, languageName, type MessageKey, useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Language } from "@/lib/types";
import { IssueCertificateDialog } from "./issue-certificate-dialog";

/**
 * #1083: one row per certificate type. Download issues the document the first
 * time and always returns the same stored copy. `staff` adds revoking,
 * the person's other documents and the certified-hours review.
 */
export function CertificatesPanel({
  staffUserId,
  onChanged,
}: {
  staffUserId?: number;
  onChanged?: () => void;
}) {
  const { t, language } = useLocale();
  const staff = staffUserId !== undefined;
  const canExport = useCan(CAPABILITIES.LOGISTICS_STATS);
  const [data, setData] = useState<CertificateOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locale, setLocale] = useState<Language>(language);
  const [certifiedHours, setCertifiedHours] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<string | null>(null);
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

  async function run(key: string, action: () => Promise<unknown>, done?: string) {
    setPending(key);
    try {
      await action();
      if (done) toast.success(done, { compactTitle: t("toastCertificate") });
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(apiErrorText(err, t, t("couldNotUseCertificate")), t("toastCertificate"));
    } finally {
      setPending(null);
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

  const download = (id: number) =>
    staff ? certificatesApi.download(id) : certificatesApi.downloadMine(id);
  const issue = (type: CertificateType, refresh = false) =>
    staff
      ? certificateTypesApi.issue({ typeId: type.id, userId: staffUserId, locale, refresh })
      : certificateTypesApi.issueMine(type.id, locale, refresh);
  const rows = (data.types ?? []).filter((type) => !type.requiresActivity);
  const live = (type: CertificateType) =>
    data.certificates.find(
      (cert) =>
        cert.typeId === type.id &&
        cert.locale === locale &&
        !cert.revokedAt &&
        !cert.supersededAt &&
        !cert.activityName,
    );
  const shown = new Set(rows.flatMap((type) => live(type)?.id ?? []));
  const others = data.certificates.filter((cert) => !shown.has(cert.id));
  const eligibility = data.eligibility;
  const awardInput =
    certifiedHours ?? (data.settings?.awardHours == null ? "" : String(data.settings.awardHours));
  const dateFormat = new Intl.DateTimeFormat(LOCALE_CODES[language], { dateStyle: "medium" });

  const rowMenu = (cert: Certificate) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton variant="ghost" label={cert.typeName ?? t("certificates")}>
          <DotsThreeIcon />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={`/verify/${encodeURIComponent(cert.code)}`} target="_blank" rel="noreferrer">
            {t("certificateVerifyTitle")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            setRevokeReason("");
            setRevoking(cert);
          }}
        >
          {t("certificateRevoke")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const body = (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={locale} onValueChange={(v) => setLocale(v as Language)}>
          <SelectTrigger aria-label={t("language")} className="w-44">
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
        {staff && (
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {canExport && (
              <Button
                variant="outline"
                disabled={pending !== null}
                onClick={() =>
                  void run("evidence", () => certificatesApi.downloadEvidence(staffUserId))
                }
              >
                <DownloadSimpleIcon />
                {t("certificatePersonEvidenceCsv")}
              </Button>
            )}
            <IssueCertificateDialog userId={staffUserId} onIssued={() => void load()} />
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("certificatesNone")}</p>
      ) : (
        <ul className="divide-border/60 divide-y">
          {rows.map((type) => {
            const cert = live(type);
            const blocked = !cert && Boolean(type.availability);
            return (
              <li key={type.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{type.name[language]}</p>
                  {cert && (
                    <p className="text-muted-foreground text-sm">
                      {dateFormat.format(new Date(cert.issuedAt))}
                      {cert.outdated && ` · ${t("certificateOutdated")}`}
                    </p>
                  )}
                  {blocked && type.availability && (
                    <p className="text-muted-foreground text-sm">
                      {t(`apiError_certificate_${type.availability}` as MessageKey)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {cert?.outdated && (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={pending === `update-${type.id}`}
                      disabled={pending !== null}
                      onClick={() =>
                        void run(`update-${type.id}`, async () => {
                          await download((await issue(type, true)).id);
                        })
                      }
                    >
                      {t("certificateUpdate")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    loading={pending === `type-${type.id}`}
                    disabled={pending !== null || blocked}
                    onClick={() =>
                      void run(`type-${type.id}`, async () => {
                        await download((cert ?? (await issue(type))).id);
                      })
                    }
                  >
                    <DownloadSimpleIcon />
                    {t("certificateDownload")}
                  </Button>
                  {staff && cert ? rowMenu(cert) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {staff && others.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-muted-foreground text-sm font-medium">
            {t("certificateOtherDocuments")}
          </h3>
          <ul className="divide-border/60 divide-y">
            {others.map((cert) => (
              <li key={cert.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                  <span className="font-medium">{cert.typeName}</span>
                  <span className="text-muted-foreground text-sm">
                    {[
                      cert.activityName,
                      cert.locale.toUpperCase(),
                      dateFormat.format(new Date(cert.issuedAt)),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {cert.revokedAt ? (
                    <StatusBadge tone="danger">{t("certificateRevoked")}</StatusBadge>
                  ) : cert.supersededAt ? (
                    <StatusBadge>{t("certificateSuperseded")}</StatusBadge>
                  ) : null}
                </div>
                {cert.revokedAt ? null : (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      loading={pending === `cert-${cert.id}`}
                      disabled={pending !== null}
                      onClick={() => void run(`cert-${cert.id}`, () => download(cert.id))}
                    >
                      <DownloadSimpleIcon />
                      {t("certificateDownload")}
                    </Button>
                    {rowMenu(cert)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {staff && (
        <section className="space-y-4 border-t pt-5">
          <div className="space-y-1">
            <h3 className="font-medium">{t("certificateCertifiedHours")}</h3>
            <p className="text-muted-foreground text-sm tabular-nums">
              {t("certificateHoursSoFar", { hours: String(eligibility.hours) })}
              {eligibility.certifiedHours != null &&
                ` · ${t("certificateAwardedHours", { hours: String(eligibility.certifiedHours) })}`}
            </p>
            {eligibility.approval && (
              <p className="text-muted-foreground text-sm">
                {t("certificateOverrideReason")}: {eligibility.approval.reason}
              </p>
            )}
          </div>
          <p className="text-muted-foreground text-sm">{t("certificateAwardHelp")}</p>
          <div className="@container">
            <div className="grid items-start gap-4 @lg:grid-cols-[10rem_minmax(0,1fr)_auto]">
              <div className="space-y-2">
                <Label htmlFor="certificate-award-hours">{t("certificateCertifiedHours")}</Label>
                <Input
                  id="certificate-award-hours"
                  type="number"
                  min={0.01}
                  max={999}
                  step={0.01}
                  value={awardInput}
                  onChange={(e) => setCertifiedHours(e.target.value)}
                  disabled={pending !== null}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="certificate-override">{t("certificateOverrideReason")}</Label>
                <Input
                  id="certificate-override"
                  value={reason}
                  maxLength={2000}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={pending !== null}
                />
              </div>
              <div className="@lg:pt-[1.75rem]">
                <SubmitButton
                  pending={pending === "approve"}
                  disabled={
                    pending !== null ||
                    !reason.trim() ||
                    !Number.isFinite(Number(awardInput)) ||
                    Number(awardInput) <= 0 ||
                    Number(awardInput) > 999
                  }
                  onClick={() =>
                    void run(
                      "approve",
                      () => certificatesApi.approve(staffUserId, Number(awardInput), reason.trim()),
                      t("certificateApprovedToast"),
                    )
                  }
                >
                  {t("certificateApproveHours")}
                </SubmitButton>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );

  return (
    <>
      {staff ? (
        <SectionCard title={t("certificates")} icon={SealCheckIcon}>
          {body}
        </SectionCard>
      ) : (
        body
      )}
      {staff ? (
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
                pending={pending !== null}
                disabled={!revokeReason.trim()}
                onClick={() => {
                  const target = revoking;
                  if (!target) return;
                  setRevoking(null);
                  void run(
                    "revoke",
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
      ) : null}
    </>
  );
}
