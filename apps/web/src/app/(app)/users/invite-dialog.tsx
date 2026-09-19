"use client";

import { CopyIcon, LinkIcon, UserPlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { MultiSelect } from "@/components/common/multi-select";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type {
  EnterpriseSummary,
  Invite,
  InviteKind,
  RoleSummary,
  UserInviteLink,
} from "@/lib/types";

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
 * Pre-assigned roles (roleIds) are independent of this and can be combined
 * with either of the above (e.g. a sponsor rep also holding a staff role).
 */
export function InviteUserDialog({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const { t } = useLocale();
  const copyToClipboard = useCopyToClipboard();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [enterpriseId, setEnterpriseId] = useState<string>("");
  const [allowClosedForms, setAllowClosedForms] = useState(false);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [groups, setGroups] = useState<RoleSummary[]>([]);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<Invite | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [shareable, setShareable] = useState(false);
  const [maxRedeems, setMaxRedeems] = useState("");
  const [expiryMinutes, setExpiryMinutes] = useState("10080");
  const [neverExpires, setNeverExpires] = useState(false);

  useEffect(() => {
    if (!open) return;
    api
      .get<{ enterprises: EnterpriseSummary[] }>("/api/invites/enterprise-options")
      .then((r) => setEnterprises(r.enterprises))
      .catch(() => setEnterprises([]));
    api
      .get<RoleSummary[]>("/api/roles")
      // A protected role (system:superadmin today, CLI-only, H8) is never
      // offerable as a pre-assignable invite role even though the list
      // endpoint returns it — assigning it would 403 server-side anyway.
      .then((roles) => setGroups(roles.filter((r) => !r.isProtected)))
      .catch(() => setGroups([]));
  }, [open]);

  function reset() {
    setEmail("");
    setEnterpriseId("");
    setAllowClosedForms(false);
    setRoleIds([]);
    setCreated(null);
    setCreatedUrl(null);
    setShareable(false);
    setMaxRedeems("");
    setExpiryMinutes("10080");
    setNeverExpires(false);
  }

  async function submit() {
    const parsedMax = maxRedeems.trim() ? Number(maxRedeems) : null;
    const parsedExpiry = expiryMinutes.trim() ? Number(expiryMinutes) : NaN;
    if (shareable && parsedMax !== null && (!Number.isInteger(parsedMax) || parsedMax < 1)) {
      toast.error(t("maxRedeemsDesc"));
      return;
    }
    if (shareable && !neverExpires && (!Number.isInteger(parsedExpiry) || parsedExpiry < 1)) {
      toast.error(t("expiryMinutesDesc"));
      return;
    }
    const kind: InviteKind = enterpriseId ? "sponsor" : allowClosedForms ? "participant" : "staff";
    if (shareable && kind === "staff" && roleIds.length === 0) {
      toast.error(t("staffLinkGroupsRequired"));
      return;
    }
    setPending(true);
    try {
      if (shareable) {
        const link = await api.post<UserInviteLink>("/api/invites/user-links", {
          kind,
          ...(kind === "sponsor" ? { enterpriseId: Number(enterpriseId) } : {}),
          roleIds: roleIds.map(Number),
          maxRedeems: parsedMax,
          expiresInMinutes: neverExpires ? null : parsedExpiry,
        });
        setCreatedUrl(link.url);
        toast.success(t("userInviteLinkCreated"));
      } else {
        const invite = await api.post<Invite>("/api/invites", {
          email: email.trim().toLowerCase(),
          kind,
          ...(kind === "sponsor" ? { enterpriseId: Number(enterpriseId) } : {}),
          roleIds: roleIds.map(Number),
        });
        setCreated(invite);
        toast.success(t("inviteSentMsg"));
      }
      await onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotCreateInvite"));
    } finally {
      setPending(false);
    }
  }

  const claimUrl =
    createdUrl ??
    (created?.token ? `${window.location.origin}/claim-account?token=${created.token}` : "");

  return (
    <SidePanelEditor
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
      footer={
        created || createdUrl ? (
          <Button onClick={() => setOpen(false)}>{t("done")}</Button>
        ) : (
          <SubmitButton pending={pending} onClick={submit}>
            {t("sendInvite")}
          </SubmitButton>
        )
      }
    >
      {created || createdUrl ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {created
              ? `${t("inviteSentToPrefix")} ${created.email}. ${t("inviteSentToSuffix")}`
              : t("linkCreated")}
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
                void copyToClipboard(claimUrl);
              }}
            >
              <CopyIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Checkbox
              id="invite-shareable"
              checked={shareable}
              onCheckedChange={(checked) => setShareable(checked === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="invite-shareable" className="leading-5">
                <LinkIcon className="mr-1 inline size-4" aria-hidden="true" /> {t("createLink")}
              </Label>
              <p className="text-muted-foreground text-xs">{t("inviteUserDesc")}</p>
            </div>
          </div>
          {!shareable && (
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
          )}
          <div className="space-y-2">
            <Label htmlFor="invite-capability-groups">{t("rolesTitle")}</Label>
            <MultiSelect
              inDialog
              id="invite-capability-groups"
              options={groups.map((g) => ({ value: String(g.id), label: g.name }))}
              value={roleIds}
              onChange={setRoleIds}
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
          {shareable && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="invite-max-redeems">{t("maxRedeemsLabel")}</Label>
                <Input
                  id="invite-max-redeems"
                  type="number"
                  min="1"
                  value={maxRedeems}
                  onChange={(event) => setMaxRedeems(event.target.value)}
                  placeholder={t("unlimitedRedeems")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-expiry-minutes">{t("expiryMinutesLabel")}</Label>
                <Input
                  id="invite-expiry-minutes"
                  type="number"
                  min="1"
                  value={expiryMinutes}
                  disabled={neverExpires}
                  onChange={(event) => setExpiryMinutes(event.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="invite-never-expires"
                    checked={neverExpires}
                    onCheckedChange={(checked) => setNeverExpires(checked === true)}
                  />
                  <Label htmlFor="invite-never-expires">{t("neverExpiresLabel")}</Label>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </SidePanelEditor>
  );
}
