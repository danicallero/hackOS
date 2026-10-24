"use client";

import { CertificateIcon } from "@phosphor-icons/react/dist/csr/Certificate";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { useState } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { IconButton } from "@/components/common/icon-button";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
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
import { useServerResource } from "@/hooks/use-server-resource";
import { apiErrorText } from "@/lib/api-error-text";
import { type Certificate, certificatesApi, certificateTypesApi } from "@/lib/certificates";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { IssueCertificateDialog } from "./issue-certificate-dialog";

/** #1083: named guest documents remain manageable after the issuance dialog closes. */
export function IssuedCertificates() {
  const { t, language } = useLocale();
  const issued = useServerResource(["issued-certificates"], certificateTypesApi.issued);
  const [status, setStatus] = useState("all");
  const [scope, setScope] = useState("all");
  const [pending, setPending] = useState(false);
  const [revoking, setRevoking] = useState<Certificate | null>(null);
  const [reason, setReason] = useState("");
  async function run(action: () => Promise<unknown>) {
    setPending(true);
    try {
      await action();
      issued.reload();
    } catch (err) {
      toast.error(apiErrorText(err, t, t("couldNotUseCertificate")), t("toastCertificate"));
    } finally {
      setPending(false);
    }
  }
  const columns: Column<Certificate>[] = [
    {
      id: "recipient",
      header: t("certificateRecipientName"),
      cell: (c) => c.recipientName,
      sortValue: (c) => c.recipientName,
    },
    {
      id: "type",
      header: t("certificateType"),
      cell: (c) => (
        <div>
          <p>{c.typeName}</p>
          {c.activityName && <p className="text-muted-foreground text-sm">{c.activityName}</p>}
        </div>
      ),
    },
    {
      id: "code",
      header: t("certificateCodeLabel"),
      cell: (c) => <span className="font-mono text-xs">{c.code}</span>,
    },
    {
      id: "issued",
      header: t("certificateIssuedDate"),
      cell: (c) =>
        new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(c.issuedAt)),
      sortValue: (c) => c.issuedAt,
    },
    {
      id: "status",
      header: t("statusColumn"),
      cell: (c) => t(c.revokedAt ? "certificateRevoked" : "certificateValid"),
    },
  ];
  const data = (issued.data?.items ?? []).filter(
    (c) =>
      (scope !== "guests" || c.userId == null) &&
      (status === "all" || (status === "valid" ? !c.revokedAt : !!c.revokedAt)),
  );
  return (
    <SectionCard
      variant="plain"
      icon={CertificateIcon}
      title={t("certificateIssuedRegister")}
      action={<IssueCertificateDialog onIssued={issued.reload} />}
    >
      <div className="flex flex-wrap gap-3">
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger aria-label={t("certificateRecipients")} className="w-full sm:w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="guests">{t("certificateGuestRecipients")}</SelectItem>
            <SelectItem value="all">{t("certificateAllRecipients")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label={t("statusColumn")} className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("certificateAllStatuses")}</SelectItem>
            <SelectItem value="valid">{t("certificateValid")}</SelectItem>
            <SelectItem value="revoked">{t("certificateRevoked")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DataTable
        columns={columns}
        data={data}
        getRowId={(c) => String(c.id)}
        searchable={(c) => `${c.recipientName} ${c.typeName} ${c.activityName} ${c.code}`}
        loading={issued.loading}
        pageSize={15}
        error={
          issued.error
            ? {
                message: apiErrorText(issued.error, t, t("couldNotLoadCertificates")),
                onRetry: issued.reload,
              }
            : undefined
        }
        rowActions={(c) =>
          c.revokedAt ? null : (
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => void run(() => certificatesApi.download(c.id))}
              >
                <DownloadSimpleIcon />
                {t("certificateDownload")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton variant="ghost" label={c.recipientName}>
                    <DotsThreeIcon />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a
                      href={`/verify/${encodeURIComponent(c.code)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("certificateVerifyTitle")}
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      setReason("");
                      setRevoking(c);
                    }}
                  >
                    {t("certificateRevoke")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
      />
      <Modal
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t("certificateRevokeTitle")}
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setRevoking(null)}>
              {t("cancel")}
            </Button>
            <SubmitButton
              pending={pending}
              disabled={!reason.trim()}
              onClick={() => {
                const target = revoking;
                if (!target) return;
                void run(async () => {
                  await certificatesApi.revoke(target.id, reason.trim());
                  setRevoking(null);
                });
              }}
            >
              {t("certificateRevoke")}
            </SubmitButton>
          </>
        }
      >
        <Label htmlFor="issued-revoke-reason">{t("reasonLabel")}</Label>
        <Input
          id="issued-revoke-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          disabled={pending}
        />
      </Modal>
    </SectionCard>
  );
}
