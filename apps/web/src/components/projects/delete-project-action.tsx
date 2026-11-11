"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { invalidateProjectReads, type NativeProject } from "@/lib/native-projects";

/** H19/H21: deletion is explicit; the server enforces membership, phase and queue guards. */
export function DeleteProjectAction({
  project,
  staff,
  canManage = false,
  disabled,
}: {
  project: Pick<NativeProject, "id" | "name" | "canEdit" | "canWithdraw" | "members">;
  staff: boolean;
  canManage?: boolean;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { id, name } = project;
  const allowed = staff
    ? canManage
    : (project.canEdit || project.canWithdraw) &&
      project.members.filter((member) => member.status === "active").length === 1;
  if (!allowed) return null;
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.delete(staff ? `/api/repos/${id}` : `/api/me/projects/${id}`);
      invalidateProjectReads(id);
      setOpen(false);
      router.replace(staff ? "/projects" : "/my-project?view=all");
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotDeleteProject")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border-t border-border/60 pt-4">
      <Button
        variant="ghost"
        className="text-destructive hover:text-destructive"
        disabled={disabled}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {t("deleteWorkGroupCta")}
      </Button>
      <AlertModal
        open={open}
        onOpenChange={setOpen}
        title={t("deleteWorkGroupTitle")}
        description={t("deleteWorkGroupDesc")}
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteWorkGroupCta")}
        destructive
        pending={busy}
        onConfirm={() => void remove()}
      >
        <p className="wrap-anywhere text-sm font-medium">{name}</p>
        {error && <ContextualError message={error} />}
      </AlertModal>
    </div>
  );
}
