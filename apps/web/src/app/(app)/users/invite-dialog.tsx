"use client";

import { CopyIcon, UserPlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { Modal } from "@/components/common/modal";
import { MultiSelect } from "@/components/common/multi-select";
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
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { EnterpriseSummary, Invite, InviteKind, PermissionGroupSummary } from "@/lib/types";

/**
 * Invite a user (H9/H10). Admin picks the account kind and, optionally,
 * capability groups the account is pre-loaded with on acceptance (H8). Sponsor
 * invites require an enterprise; the account is auto-linked to it when accepted.
 */
export function InviteUserDialog() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<InviteKind>("staff");
  const [enterpriseId, setEnterpriseId] = useState<string>("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [groups, setGroups] = useState<PermissionGroupSummary[]>([]);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<Invite | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .get<{ enterprises: EnterpriseSummary[] }>("/api/invites/enterprise-options")
      .then((r) => setEnterprises(r.enterprises))
      .catch(() => setEnterprises([]));
    api
      .get<PermissionGroupSummary[]>("/api/permission-groups")
      .then(setGroups)
      .catch(() => setGroups([]));
  }, [open]);

  function reset() {
    setEmail("");
    setKind("staff");
    setEnterpriseId("");
    setGroupIds([]);
    setCreated(null);
  }

  async function submit() {
    setPending(true);
    try {
      const invite = await api.post<Invite>("/api/invites", {
        email: email.trim().toLowerCase(),
        kind,
        ...(kind === "sponsor" && enterpriseId ? { enterpriseId: Number(enterpriseId) } : {}),
        groupIds: groupIds.map(Number),
      });
      setCreated(invite);
      toast.success(t("inviteSentMsg"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotCreateInvite"));
    } finally {
      setPending(false);
    }
  }

  const claimUrl = created?.token
    ? `${window.location.origin}/claim-account?token=${created.token}`
    : "";

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
      trigger={
        <Button>
          <UserPlusIcon className="size-4" aria-hidden="true" /> {t("inviteUser")}
        </Button>
      }
      icon={UserPlusIcon}
      title={t("inviteAUser")}
      description={t("inviteUserDesc")}
      footer={
        created ? (
          <Button onClick={() => setOpen(false)}>{t("done")}</Button>
        ) : (
          <SubmitButton pending={pending} disabled={!email.includes("@")} onClick={submit}>
            {t("sendInvite")}
          </SubmitButton>
        )
      }
    >
      {created ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {t("inviteSentToPrefix")} <strong className="text-foreground">{created.email}</strong>.{" "}
            {t("inviteSentToSuffix")}
          </p>
          <div className="flex items-center gap-2">
            <Input value={claimUrl} readOnly className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("copyInviteLink")}
              title={t("copyInviteLink")}
              onClick={() => {
                navigator.clipboard.writeText(claimUrl);
                toast.success(t("copied"));
              }}
            >
              <CopyIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">{t("email")}</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-kind">{t("accountTypeLabel")}</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                const next = v as InviteKind;
                setKind(next);
                // Only staff accounts carry capability groups (H8). Clear any
                // stale selection when switching to sponsor/participant so a
                // hidden, previously-picked group isn't sent on submit.
                if (next !== "staff") setGroupIds([]);
              }}
            >
              <SelectTrigger id="invite-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">{t("staffOrg")}</SelectItem>
                <SelectItem value="sponsor">{t("sponsorOption")}</SelectItem>
                <SelectItem value="participant">{t("participantOption")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "sponsor" && (
            <div className="space-y-2">
              <Label htmlFor="invite-enterprise">{t("enterpriseLabel")}</Label>
              <EntityCombobox
                id="invite-enterprise"
                inDialog
                options={enterprises}
                value={enterpriseId}
                onChange={setEnterpriseId}
                getId={(e) => e.id}
                getLabel={(e) => e.name}
                placeholder={t("selectSponsorEnterprise")}
              />
              <p className="text-muted-foreground text-xs">{t("linkedAutomatically")}</p>
            </div>
          )}
          {/* Capability groups are staff-only (H8): sponsors control just their
              own enterprise/challenge through the sponsors→enterprise ownership
              link created on accept, not via capabilities; participants need no
              staff capabilities. groupIds is still POSTed (empty []) for them. */}
          {kind === "staff" && (
            <div className="space-y-2">
              <Label htmlFor="invite-capability-groups">{t("capabilityGroupsLabel")}</Label>
              <MultiSelect
                inDialog
                id="invite-capability-groups"
                options={groups.map((g) => ({ value: String(g.id), label: g.name }))}
                value={groupIds}
                onChange={setGroupIds}
                placeholder={t("optionalPreassignGroups")}
                searchPlaceholder={t("searchGroupsPlaceholder")}
                emptyText={t("noPermissionGroupsYet")}
              />
              <p className="text-muted-foreground text-xs">{t("accountHoldsPermissions")}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
