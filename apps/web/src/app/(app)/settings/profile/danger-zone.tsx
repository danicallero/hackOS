"use client";

// Self-service account deletion (H54). Collapsed by default — this is the
// one destructive control on the personal settings page, so it stays out of
// the way until the user deliberately opens it.

import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ApiError, api } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import type { AccountRemovalEligibility } from "@/lib/privacy-removal";

export function DangerZoneCard() {
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [eligibility, setEligibility] = useState<AccountRemovalEligibility | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get<AccountRemovalEligibility>("/api/me/removal-eligibility")
      .then((result) => {
        if (active) setEligibility(result);
      })
      .catch(() => {
        if (active) setEligibility(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function deleteAccount() {
    setPending(true);
    try {
      await api.delete("/api/me");
      toast.success(t("accountDeleted"));
      await signOut();
      window.location.assign("/login");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveAccount"));
      setPending(false);
    }
  }

  return (
    <SectionCard icon={TriangleAlertIcon} title={t("dangerZone")}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground -ml-2">
            <ChevronDownIcon className={open ? "size-4 rotate-180" : "size-4"} />
            {open ? t("hideDangerZone") : t("showDangerZone")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          {loading ? (
            <p className="text-muted-foreground text-sm">{t("checkingRemovalEligibility")}</p>
          ) : eligibility?.action === "delete" ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-pretty text-sm">
                {t("deleteMyAccountDesc")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={() => setConfirmOpen(true)}
              >
                {t("deleteMyAccount")}
              </Button>
            </div>
          ) : (
            <p role="alert" className="text-muted-foreground text-pretty text-sm">
              {t("cannotSelfDeleteAccount")}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
      <AlertModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("deleteMyAccountConfirmTitle")}
        description={t("areYouSureCantBeUndone")}
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteAction")}
        pending={pending}
        destructive
        reverseActions
        onConfirm={deleteAccount}
      >
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-pretty text-sm">
          <li>{t("accountAccessRevokedConsequence")}</li>
          <li>{t("freshAccountRemovedConsequence")}</li>
          <li>{t("cantBeUndone")}</li>
        </ul>
      </AlertModal>
    </SectionCard>
  );
}
