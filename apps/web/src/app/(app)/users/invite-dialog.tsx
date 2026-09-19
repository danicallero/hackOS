"use client";

import { CopyIcon, LinkIcon, MailIcon, UserPlusIcon } from "lucide-react";
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
import type {
  EnterpriseSummary,
  Invite,
  InviteKind,
  RoleSummary,
  UserInviteLink,
} from "@/lib/types";

type Method = "email" | "link";
type Uses = "unlimited" | "limited";
type Expiration = "week" | "custom" | "never";

export function InviteUserDialog({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const { t } = useLocale();
  const copy = useCopyToClipboard();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>("email");
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [enterpriseId, setEnterpriseId] = useState("");
  const [applicationAccess, setApplicationAccess] = useState(false);
  const [uses, setUses] = useState<Uses>("unlimited");
  const [maxUses, setMaxUses] = useState("10");
  const [expiration, setExpiration] = useState<Expiration>("week");
  const [customExpiresAt, setCustomExpiresAt] = useState("");
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ email?: string; url?: string; summary: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRolesLoading(true);
    setRolesError(false);
    void api
      .get<{ enterprises: EnterpriseSummary[] }>("/api/invites/enterprise-options")
      .then((enterpriseData) => setEnterprises(enterpriseData.enterprises))
      .catch(() => setEnterprises([]));
    void api
      .get<RoleSummary[]>("/api/roles")
      .then((roleData) => {
        setRoles(
          roleData.filter((role) => !role.isProtected && role.name.toLowerCase() !== "sponsor"),
        );
      })
      .catch(() => {
        setRoles([]);
        setRolesError(true);
      })
      .finally(() => setRolesLoading(false));
  }, [open]);

  function reset() {
    setMethod("email");
    setEmail("");
    setRoleIds([]);
    setEnterpriseId("");
    setApplicationAccess(false);
    setUses("unlimited");
    setMaxUses("10");
    setExpiration("week");
    setCustomExpiresAt("");
    setResult(null);
    setError(null);
  }

  async function submit() {
    setError(null);
    if (method === "email" && !email.trim()) return setError(t("emailRequired"));
    const kind: InviteKind = enterpriseId ? "sponsor" : applicationAccess ? "participant" : "staff";
    if (method === "link" && kind === "staff" && roleIds.length === 0)
      return setError(t("staffLinkGroupsRequired"));
    const limitedUses = Number(maxUses);
    if (
      method === "link" &&
      uses === "limited" &&
      (!Number.isInteger(limitedUses) || limitedUses < 1)
    )
      return setError(t("enterAtLeastOneUse"));
    const customMinutes = customExpiresAt
      ? Math.ceil((new Date(customExpiresAt).getTime() - Date.now()) / 60_000)
      : 0;
    if (method === "link" && expiration === "custom" && customMinutes < 1)
      return setError(t("selectExpirationDate"));
    setPending(true);
    try {
      if (method === "email") {
        const invite = await api.post<Invite>("/api/invites", {
          email: email.trim().toLowerCase(),
          kind,
          ...(kind === "sponsor" ? { enterpriseId: Number(enterpriseId) } : {}),
          roleIds: roleIds.map(Number),
        });
        setResult({ email: invite.email, summary: invite.email });
      } else {
        const link = await api.post<UserInviteLink>("/api/invites/user-links", {
          kind,
          ...(kind === "sponsor" ? { enterpriseId: Number(enterpriseId) } : {}),
          roleIds: roleIds.map(Number),
          maxRedeems: uses === "limited" ? limitedUses : null,
          expiresInMinutes:
            expiration === "never" ? null : expiration === "week" ? 10_080 : customMinutes,
        });
        const selectedEnterprise = enterprises.find(
          (enterprise) => String(enterprise.id) === enterpriseId,
        )?.name;
        setResult({
          url: link.url,
          summary: [
            selectedEnterprise,
            uses === "limited"
              ? t("redeemedCountLabel", { used: 0, maximum: limitedUses })
              : t("unlimitedRedeems"),
            expiration === "never" ? t("linkNeverExpires") : t("sevenDays"),
          ]
            .filter(Boolean)
            .join(" · "),
        });
      }
      await onChanged?.();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t("couldNotCreateInvite"));
    } finally {
      setPending(false);
    }
  }

  const fieldClass = "space-y-2";
  return (
    <SidePanelEditor
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
      trigger={
        <Button>
          <UserPlusIcon className="size-4" aria-hidden="true" /> {t("inviteUser")}
        </Button>
      }
      className="w-[min(40rem,calc(100vw-1rem))] sm:w-[min(40rem,calc(100vw-2rem))]"
      icon={method === "email" ? MailIcon : LinkIcon}
      title={method === "email" ? t("inviteUser") : t("createLink")}
      footer={
        result ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={reset}>
              {t("createAnotherLink")}
            </Button>
            <Button onClick={() => setOpen(false)}>{t("done")}</Button>
          </div>
        ) : (
          <SubmitButton pending={pending} onClick={submit}>
            {method === "email" ? t("sendInvite") : t("createLink")}
          </SubmitButton>
        )
      }
    >
      {result ? (
        <div className="space-y-4">
          <h2 className="type-section-title">
            {result.url ? t("inviteLinkCreated") : t("invitationSent")}
          </h2>
          {result.email && <p className="font-medium">{result.email}</p>}
          {result.url && (
            <>
              <div className="flex gap-2">
                <Input value={result.url} readOnly className="font-mono text-xs" />
                <Button variant="outline" onClick={() => void copy(result.url as string)}>
                  <CopyIcon className="size-4" aria-hidden="true" /> {t("copyInviteLink")}
                </Button>
              </div>
              <p className="text-muted-foreground text-sm">{result.summary}</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label={t("inviteUser")}>
            <Button
              type="button"
              variant={method === "email" ? "default" : "outline"}
              onClick={() => setMethod("email")}
            >
              <MailIcon className="size-4" aria-hidden="true" /> {t("emailInvitation")}
            </Button>
            <Button
              type="button"
              variant={method === "link" ? "default" : "outline"}
              onClick={() => setMethod("link")}
            >
              <LinkIcon className="size-4" aria-hidden="true" /> {t("inviteLink")}
            </Button>
          </div>
          {method === "email" && (
            <div className={fieldClass}>
              <Label htmlFor="invite-email">{t("email")}</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                placeholder={t("emailPlaceholder")}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          )}
          <section className="space-y-4">
            <h2 className="type-section-title">{t("access")}</h2>
            <div className={fieldClass}>
              <Label htmlFor="invite-roles">{t("rolesTitle")}</Label>
              <MultiSelect
                inDialog
                id="invite-roles"
                options={roles.map((role) => ({ value: String(role.id), label: role.name }))}
                value={roleIds}
                onChange={setRoleIds}
                disabled={rolesLoading || rolesError}
                aria-describedby={rolesError ? "invite-roles-error" : undefined}
                placeholder={t("selectRolesPlaceholder")}
                searchPlaceholder={t("searchRolesPlaceholder")}
                emptyText={t("noRolesYet")}
              />
              {rolesError && (
                <p id="invite-roles-error" className="text-destructive text-sm" role="alert">
                  {t("couldNotLoadRoles")}
                </p>
              )}
            </div>
            <div className={fieldClass}>
              <Label htmlFor="invite-enterprise">{t("enterpriseLabel")}</Label>
              <EntityCombobox
                id="invite-enterprise"
                inDialog
                options={enterprises}
                value={enterpriseId}
                onChange={(value) => setEnterpriseId(value)}
                getId={(enterprise) => enterprise.id}
                getLabel={(enterprise) => enterprise.name}
                placeholder={t("selectEnterprisePlaceholder")}
              />
              {enterpriseId && (
                <p className="text-muted-foreground text-xs">{t("sponsorRoleAutomatic")}</p>
              )}
            </div>
            <div className="space-y-3">
              <h3 className="type-label">{t("applicationAccess")}</h3>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="invite-application-access"
                  checked={applicationAccess}
                  disabled={Boolean(enterpriseId)}
                  onCheckedChange={(checked) => setApplicationAccess(checked === true)}
                />
                <Label htmlFor="invite-application-access">{t("allowClosedFormsLabel")}</Label>
              </div>
            </div>
          </section>
          {method === "link" && (
            <section className="space-y-4">
              <h2 className="type-section-title">{t("linkSettings")}</h2>
              <div className="space-y-2">
                <Label>{t("uses")}</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={uses === "unlimited"}
                      onChange={() => setUses("unlimited")}
                    />{" "}
                    {t("unlimitedRedeems")}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={uses === "limited"}
                      onChange={() => setUses("limited")}
                    />{" "}
                    {t("limitTo")}
                  </label>
                  {uses === "limited" && (
                    <Input
                      className="w-20"
                      type="number"
                      min="1"
                      value={maxUses}
                      onChange={(event) => setMaxUses(event.target.value)}
                    />
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("expiration")}</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={expiration === "week"}
                      onChange={() => setExpiration("week")}
                    />{" "}
                    {t("sevenDays")}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={expiration === "custom"}
                      onChange={() => setExpiration("custom")}
                    />{" "}
                    {t("custom")}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={expiration === "never"}
                      onChange={() => setExpiration("never")}
                    />{" "}
                    {t("never")}
                  </label>
                </div>
                {expiration === "custom" && (
                  <Input
                    type="datetime-local"
                    value={customExpiresAt}
                    onChange={(event) => setCustomExpiresAt(event.target.value)}
                  />
                )}
              </div>
            </section>
          )}
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </SidePanelEditor>
  );
}
