"use client";

import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { PermissionGroupDetail } from "@/lib/types";

/**
 * H8/H53 template drift recovery stays separate from general group editing:
 * reset is an audited, irreversible restoration of direct grants and includes.
 */
export function TemplateResetSection({
  group,
  templateName,
  canReset,
  onGroupUpdated,
}: {
  group: PermissionGroupDetail;
  templateName: string;
  canReset: boolean;
  onGroupUpdated: (group: PermissionGroupDetail) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resetTemplate() {
    setResetting(true);
    setError(null);
    try {
      const updated = await api.post<PermissionGroupDetail>(
        `/api/permission-groups/${group.id}/reset-template`,
        {},
      );
      onGroupUpdated(updated);
      setOpen(false);
      toast.success(t("permissionTemplateReset"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("couldNotResetPermissionTemplate"));
    } finally {
      setResetting(false);
    }
  }

  return (
    <>
      <SectionCard
        icon={KeyRoundIcon}
        title={t("permissionTemplate")}
        description={t("resetPermissionTemplatePreserves")}
        action={
          canReset ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!group.templateDrifted || resetting}
              aria-describedby="template-reset-status"
              onClick={() => {
                setError(null);
                setOpen(true);
              }}
            >
              {t("resetPermissionTemplate")}
            </Button>
          ) : undefined
        }
      >
        <p id="template-reset-status" className="text-muted-foreground text-pretty text-sm">
          {group.templateDrifted
            ? t("resetPermissionTemplateDescription")
            : t("resetPermissionTemplateUnavailable")}
        </p>
      </SectionCard>

      <AlertModal
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setError(null);
        }}
        title={t("resetPermissionTemplateTitle", { template: templateName })}
        description={t("resetPermissionTemplateDescription")}
        cancelLabel={t("cancel")}
        confirmLabel={t("resetPermissionTemplate")}
        pending={resetting}
        onConfirm={() => void resetTemplate()}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground text-pretty text-sm">
            {t("resetPermissionTemplatePreserves")}
          </p>
          {error && <ContextualError message={error} />}
        </div>
      </AlertModal>
    </>
  );
}
