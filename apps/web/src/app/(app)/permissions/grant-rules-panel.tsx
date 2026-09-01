"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon, ZapIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertModal } from "@/components/common/alert-modal";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { EnterpriseSummary, RoleGrantRule, RoleSummary } from "@/lib/types";
import { ALL_TRIGGER_EVENTS, triggerEventLabel } from "./helpers";

/**
 * Admin CRUD for role_grant_rules (H8, H43-H46): configurable "when X
 * happens, grant/revoke role Y (optionally only for enterprise Z)" rules.
 * The trigger-event vocabulary (packages/shared/src/role-grant-triggers.ts)
 * is fixed; what an admin can freely change is which role each event
 * grants/revokes and whether it's scoped to one enterprise — no code change
 * needed to reconfigure that. The API applies the exact same role-mutation
 * authority (position hierarchy + capability possession) to every mutation
 * here that direct role assignment uses, so the role picker below excludes
 * protected roles the same way the roles list already does.
 *
 * Lives per-role now (H8 verification round): mounted as the "Grant rules"
 * tab/nav-row on `RoleEditor`, scoped to the rules that target `scopedRole`
 * via `GET /api/role-grant-rules?roleId=`. A rule's role is inherently the
 * role you're already looking at, so the role picker is dropped entirely in
 * this mode — creating a rule here only asks for trigger + action + optional
 * enterprise scope, and always targets `scopedRole.id`. The read-only,
 * cross-role "every rule in the system" view lives separately, in
 * `grant-rules-overview.tsx`.
 */

const ruleSchema = z.object({
  roleId: z.string().min(1),
  triggerEvent: z.string().min(1),
  action: z.enum(["grant", "revoke"]),
  enterpriseId: z.string(),
  enabled: z.boolean(),
});
type RuleValues = z.infer<typeof ruleSchema>;

function emptyValues(defaultRoleId?: number): RuleValues {
  return {
    roleId: defaultRoleId ? String(defaultRoleId) : "",
    triggerEvent: "",
    action: "grant",
    enterpriseId: "",
    enabled: true,
  };
}

function ruleToValues(rule: RoleGrantRule): RuleValues {
  return {
    roleId: String(rule.roleId),
    triggerEvent: rule.triggerEvent,
    action: rule.action,
    enterpriseId: rule.enterpriseId === null ? "" : String(rule.enterpriseId),
    enabled: rule.enabled,
  };
}

export function GrantRulesPanel({
  roles = [],
  scopedRole,
  disabled = false,
}: {
  /** Full role catalogue for the role picker — unused (and omittable) when `scopedRole` is set. */
  roles?: RoleSummary[];
  /** Scopes the list/create/edit to rules targeting this one role and locks the role picker to it (H8). */
  scopedRole?: RoleSummary;
  /** True for a protected role, whose rules can never be created/edited (mirrors Capabilities/Members). */
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [rules, setRules] = useState<RoleGrantRule[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RoleGrantRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleGrantRule | null>(null);
  const [deleting, setDeleting] = useState(false);

  // A protected role (system:superadmin) can never be a rule's target — the
  // API refuses it outright, so it's excluded from the picker too.
  const assignableRoles = roles.filter((r) => !r.isProtected);

  const load = useCallback(async () => {
    setLoading(true);
    const [rulesResult, enterprisesResult] = await Promise.allSettled([
      api.get<RoleGrantRule[]>("/api/role-grant-rules", {
        query: scopedRole ? { roleId: scopedRole.id } : undefined,
      }),
      api.get<{ enterprises: EnterpriseSummary[] }>("/api/enterprises"),
    ]);
    if (rulesResult.status === "fulfilled") setRules(rulesResult.value);
    else toast.error(t("couldNotLoadGrantRules"));
    // Enterprise scoping is optional; an actor without sponsor-facing access
    // simply doesn't get the enterprise picker populated.
    if (enterprisesResult.status === "fulfilled")
      setEnterprises(enterprisesResult.value.enterprises);
    setLoading(false);
  }, [t, scopedRole]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const schema = ruleSchema;
  const form = useForm<RuleValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyValues(scopedRole?.id),
  });

  function openCreate() {
    setEditing(null);
    form.reset(emptyValues(scopedRole?.id));
    setModalOpen(true);
  }

  function openEdit(rule: RoleGrantRule) {
    setEditing(rule);
    form.reset(ruleToValues(rule));
    setModalOpen(true);
  }

  async function onSubmit(values: RuleValues) {
    const payload = {
      // Scoped mode has no role field to submit a stale value from — always
      // the role this panel is mounted on.
      roleId: scopedRole ? scopedRole.id : Number(values.roleId),
      triggerEvent: values.triggerEvent,
      action: values.action,
      enterpriseId: values.enterpriseId ? Number(values.enterpriseId) : null,
      enabled: values.enabled,
    };
    try {
      if (editing) {
        await api.patch<RoleGrantRule>(`/api/role-grant-rules/${editing.id}`, payload);
        toast.success(t("grantRuleUpdated"));
      } else {
        await api.post<RoleGrantRule>("/api/role-grant-rules", payload);
        toast.success(t("grantRuleCreated"));
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : t(editing ? "couldNotSaveGrantRule" : "couldNotCreateGrantRule"),
      );
    }
  }

  async function toggleEnabled(rule: RoleGrantRule, enabled: boolean) {
    const before = rules;
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
    try {
      await api.patch<RoleGrantRule>(`/api/role-grant-rules/${rule.id}`, { enabled });
    } catch (err) {
      setRules(before);
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveGrantRule"));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/role-grant-rules/${deleteTarget.id}`);
      toast.success(t("grantRuleDeleted"));
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotDeleteGrantRule"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {!disabled && (
        <div className="flex justify-end">
          <Button onClick={openCreate}>
            <PlusIcon /> {t("newGrantRule")}
          </Button>
        </div>
      )}

      <SectionCard
        icon={scopedRole ? undefined : ZapIcon}
        title={scopedRole ? undefined : t("grantRulesTitle")}
        description={disabled ? t("superadminLockedDesc") : undefined}
        bodyClassName="p-0"
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : rules.length === 0 ? (
          <EmptyState icon={ZapIcon} title={t("noGrantRulesYetTitle")} />
        ) : (
          <ul className="divide-border divide-y">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  disabled={disabled}
                  onClick={() => openEdit(rule)}
                >
                  <p className="truncate text-sm font-medium">
                    {triggerEventLabel(rule.triggerEvent, t)}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {t(rule.action === "grant" ? "grantActionGrant" : "grantActionRevoke")}
                    {/* The role is redundant once the panel is already scoped to it. */}
                    {scopedRole ? "" : ` · ${rule.roleName}`}
                    {rule.enterpriseName ? ` · ${rule.enterpriseName}` : ""}
                  </p>
                </button>
                {!disabled && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={(checked) => toggleEnabled(rule, checked)}
                      aria-label={t("grantRuleEnabledLabel")}
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(rule)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        icon={ZapIcon}
        title={editing ? t("grantRulesTitle") : t("newGrantRule")}
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              {t("cancel")}
            </Button>
            <SubmitButton form="grant-rule-form" pending={form.formState.isSubmitting}>
              {t("createGrantRule")}
            </SubmitButton>
          </>
        }
      >
        <Form {...form}>
          <form id="grant-rule-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="triggerEvent"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("grantRuleTriggerLabel")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ALL_TRIGGER_EVENTS.map((event) => (
                        <SelectItem key={event} value={event}>
                          {triggerEventLabel(event, t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="action"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("grantRuleActionLabel")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="grant">{t("grantActionGrant")}</SelectItem>
                      <SelectItem value="revoke">{t("grantActionRevoke")}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            {/* Redundant once the panel is scoped to a single role — you're already looking at it. */}
            {!scopedRole && (
              <FormField
                control={form.control}
                name="roleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("grantRuleRoleLabel")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {assignableRoles.map((role) => (
                          <SelectItem key={role.id} value={String(role.id)}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="enterpriseId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("grantRuleEnterpriseLabel")}</FormLabel>
                  <Select
                    value={field.value === "" ? "any" : field.value}
                    onValueChange={(v) => field.onChange(v === "any" ? "" : v)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="any">{t("anyEnterpriseOption")}</SelectItem>
                      {enterprises.map((enterprise) => (
                        <SelectItem key={enterprise.id} value={String(enterprise.id)}>
                          {enterprise.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <FormLabel className="font-normal">{t("grantRuleEnabledLabel")}</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
          </form>
        </Form>
      </Modal>

      <AlertModal
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteGrantRuleQuestion")}
        description={deleteTarget ? triggerEventLabel(deleteTarget.triggerEvent, t) : ""}
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteGrantRule")}
        destructive
        pending={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
