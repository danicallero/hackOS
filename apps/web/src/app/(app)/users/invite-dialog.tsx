"use client";

import { CopyIcon, UserPlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { Modal } from "@/components/common/modal";
import { MultiSelect } from "@/components/common/multi-select";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { EnterpriseSummary, Invite, InviteKind, RoleSummary } from "@/lib/types";

/**
 * Invite a user (H9/H10). The admin no longer picks an "account type" up
 * front — roles and the enterprise link are always available, and `kind` is
 * derived from what's actually filled in on submit:
 *   - an enterprise picked -> kind "sponsor" (auto-linked to it on accept, H9/H43)
 *   - "allow closed-form submission" checked -> kind "participant" (H10: lets
 *     the invitee discover/submit a CLOSED application and auto-confirms it,
 *     independent of any pre-assigned role — most participant invites don't
 *     pre-assign one, since the application form grants a role on confirm)
 *   - neither -> kind "staff"
 * Pre-assigned roles (groupIds) are independent of this and can be combined
 * with either of the above (e.g. a sponsor rep also holding a staff role).
 */
export function InviteUserDialog() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [enterpriseId, setEnterpriseId] = useState<string>("");
  const [allowClosedForms, setAllowClosedForms] = useState(false);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [groups, setGroups] = useState<RoleSummary[]>([]);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<Invite | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .get<{ enterprises: EnterpriseSummary[] }>("/api/invites/enterprise-options")
      .then((r) => setEnterprises(r.enterprises))
      .catch(() => setEnterprises([]));
    api
      .get<RoleSummary[]>("/api/roles")
      // system:superadmin is CLI-only (H8) — never offer it as a
      // pre-assignable invite role even though the list endpoint returns it.
      .then((roles) => setGroups(roles.filter((r) => r.name !== "system:superadmin")))
      .catch(() => setGroups([]));
  }, [open]);

  function reset() {
    setEmail("");
    setEnterpriseId("");
    setAllowClosedForms(false);
    setGroupIds([]);
    setCreated(null);
  }

  async function submit() {
    setPending(true);
    try {
      const kind: InviteKind = enterpriseId
        ? "sponsor"
        : allowClosedForms
          ? "participant"
          : "staff";
      const invite = await api.post<Invite>("/api/invites", {
        email: email.trim().toLowerCase(),
        kind,
        ...(kind === "sponsor" ? { enterpriseId: Number(enterpriseId) } : {}),
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
            <Label htmlFor="invite-capability-groups">{t("rolesTitle")}</Label>
            <MultiSelect
              inDialog
              id="invite-capability-groups"
              options={groups.map((g) => ({ value: String(g.id), label: g.name }))}
              value={groupIds}
              onChange={setGroupIds}
              placeholder={t("optionalPreassignRoles")}
              searchPlaceholder={t("searchRolesPlaceholder")}
              emptyText={t("noRolesYet")}
            />
            <p className="text-muted-foreground text-xs">{t("accountHoldsPermissions")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-enterprise">{t("enterpriseLabel")}</Label>
            <EntityCombobox
              id="invite-enterprise"
              inDialog
              options={enterprises}
              value={enterpriseId}
              onChange={(v) => {
                setEnterpriseId(v);
                // A sponsor invite and the closed-form bypass are mutually
                // exclusive kinds on the backend (H9/H10) — picking an
                // enterprise here makes this a sponsor invite.
                if (v) setAllowClosedForms(false);
              }}
              getId={(e) => e.id}
              getLabel={(e) => e.name}
              placeholder={t("selectSponsorEnterprise")}
            />
            <p className="text-muted-foreground text-xs">{t("linkedAutomatically")}</p>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="invite-allow-closed-forms"
              checked={allowClosedForms}
              disabled={Boolean(enterpriseId)}
              onCheckedChange={(checked) => setAllowClosedForms(checked === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="invite-allow-closed-forms" className="leading-5">
                {t("allowClosedFormsLabel")}
              </Label>
              <p className="text-muted-foreground text-xs">{t("allowClosedFormsHint")}</p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
