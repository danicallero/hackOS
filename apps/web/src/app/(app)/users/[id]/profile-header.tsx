"use client";

// Profile identity header and the account-removal action it exposes (H10).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { IdCardIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { type AccountRemovalEligibility, accountRemovalRequest } from "@/lib/privacy-removal";
import { useCan, useMe } from "@/lib/session";
import type { UserDetail } from "@/lib/types";
import { fullName, initials, ROLE_TONE } from "./shared";

export function ProfileHeader({ user }: { user: UserDetail }) {
  const { t } = useLocale();
  return (
    <PageHeader
      leading={
        <Avatar size="lg">
          {user.image && <AvatarImage src={user.image} alt={fullName(user)} />}
          <AvatarFallback>{initials(user)}</AvatarFallback>
        </Avatar>
      }
      title={fullName(user)}
      meta={
        <>
          <span className="text-muted-foreground truncate text-sm">{user.email}</span>
          <StatusBadge tone={user.emailVerified ? "success" : "warning"} dot={false}>
            {user.emailVerified ? t("verified") : t("unverified")}
          </StatusBadge>
          <StatusBadge tone={ROLE_TONE[user.role]} className="capitalize">
            {user.role}
          </StatusBadge>
          {user.badgeId && (
            <span className="text-muted-foreground font-mono text-xs">
              {t("badgeIdInline", { id: user.badgeId })}
            </span>
          )}
        </>
      }
      secondaryActions={
        <>
          <Button asChild variant="outline" size="sm">
            <Link href={`/logistics/accreditation?userId=${user.id}`}>
              <IdCardIcon className="size-4" />
              {t("accredit")}
            </Link>
          </Button>
          <DeleteAccountButton user={user} />
        </>
      }
    />
  );
}

export function DeleteAccountButton({ user }: { user: UserDetail }) {
  const { t } = useLocale();
  const router = useRouter();
  const me = useMe();
  const canDelete = useCan(CAPABILITIES.ADMIN_ALL) && me?.id !== user.id;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [eligibility, setEligibility] = useState<AccountRemovalEligibility | null>(null);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);

  useEffect(() => {
    if (!canDelete) return;
    let active = true;
    setLoading(true);
    setEligibilityError(null);
    api
      .get<AccountRemovalEligibility>(`/api/users/${user.id}/removal-eligibility`)
      .then((result) => {
        if (active) setEligibility(result);
      })
      .catch(() => {
        if (active) setEligibilityError(t("removalEligibilityUnavailable"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canDelete, t, user.id]);

  if (!canDelete) return null;

  async function remove() {
    if (!eligibility) return;
    setPending(true);
    try {
      const request = accountRemovalRequest(user.id, eligibility.action);
      if (request.method === "DELETE") await api.delete(request.path);
      else await api.post(request.path);
      toast.success(eligibility.action === "delete" ? t("accountDeleted") : t("accountAnonymized"));
      router.push("/users");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveAccount"));
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        className="text-destructive"
        disabled={loading || !eligibility}
        onClick={() => setOpen(true)}
      >
        {loading
          ? t("checkingRemovalEligibility")
          : eligibility?.action === "delete"
            ? t("deleteAccount")
            : eligibility?.action === "anonymize"
              ? t("anonymizeAccount")
              : t("removalUnavailableAction")}
      </Button>
      {eligibilityError && (
        <p role="alert" className="text-destructive max-w-md text-pretty text-sm">
          {eligibilityError}
        </p>
      )}
      {eligibility && (
        <AlertModal
          open={open}
          onOpenChange={setOpen}
          title={
            eligibility.action === "delete" ? t("deleteThisAccount") : t("anonymizeThisAccount")
          }
          description={t("removeAccountDesc", { name: fullName(user), email: user.email })}
          cancelLabel={t("cancel")}
          confirmLabel={eligibility.action === "delete" ? t("deleteAction") : t("anonymizeAction")}
          pending={pending}
          destructive
          onConfirm={remove}
        >
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-pretty text-sm">
            <li>{t("accountAccessRevokedConsequence")}</li>
            <li>
              {eligibility.operationalHistoryRetained
                ? t("operationalHistoryRetainedConsequence")
                : t("freshAccountRemovedConsequence")}
            </li>
            <li>{t("cantBeUndone")}</li>
          </ul>
        </AlertModal>
      )}
    </div>
  );
}
