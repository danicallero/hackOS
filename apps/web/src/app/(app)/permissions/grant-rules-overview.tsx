"use client";

import { SearchIcon, ZapIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { RoleGrantRule } from "@/lib/types";
import { triggerEventLabel } from "./helpers";

/**
 * Read-only, cross-role audit view of every role_grant_rules row (H8
 * verification round). Rule creation/editing lives exclusively in the
 * per-role "Grant rules" tab now (`grant-rules-panel.tsx`, mounted on
 * `RoleEditor`, scoped to one role) — a flat unscoped list referencing roles
 * by id was the thing the prior round's UX review flagged as bolted-on. This
 * component keeps only what a per-role view structurally can't answer
 * ("every automatic rule in the system, regardless of role") and drops the
 * standalone create/edit/delete/enable-toggle UI entirely: opened from a
 * plain button next to Trash/New role rather than as an equal-weight sibling
 * tab to the role browser, since it's an occasional audit lookup, not a
 * primary workflow.
 */
export function GrantRulesOverviewModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const [rules, setRules] = useState<RoleGrantRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRules(await api.get<RoleGrantRule[]>("/api/role-grant-rules"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadGrantRules"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      load();
    }
  }, [open, load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rules;
    return rules.filter((rule) =>
      [rule.roleName, rule.enterpriseName ?? "", triggerEventLabel(rule.triggerEvent, t)]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [rules, query, t]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      icon={ZapIcon}
      title={t("allGrantRulesTitle")}
      size="lg"
    >
      <div className="space-y-4">
        <div className="relative">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("allGrantRulesSearchPlaceholder")}
            className="pl-8"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={ZapIcon} title={t("noGrantRulesYetTitle")} />
        ) : (
          <ul className="divide-border max-h-[60vh] divide-y overflow-y-auto rounded-md border">
            {filtered.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {triggerEventLabel(rule.triggerEvent, t)}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {t(rule.action === "grant" ? "grantActionGrant" : "grantActionRevoke")} ·{" "}
                    {rule.roleName}
                    {rule.enterpriseName ? ` · ${rule.enterpriseName}` : ""}
                  </p>
                </div>
                <StatusBadge tone={rule.enabled ? "success" : "neutral"}>
                  {t(rule.enabled ? "grantRuleEnabledLabel" : "grantRuleDisabledLabel")}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
