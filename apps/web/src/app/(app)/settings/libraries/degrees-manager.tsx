"use client";

import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
// Curated degree directory: same self-service proposal limits as universities,
// with staff create, rename and deletion controls in the shared Libraries area.
import { GraduationCapIcon } from "@phosphor-icons/react/dist/csr/GraduationCap";
import { useCallback, useEffect, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import type { Column } from "@/components/common/data-table";
import { DataTable } from "@/components/common/data-table";
import { DegreePicker } from "@/components/common/degree-picker";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { LibraryToolbar } from "./library-toolbar";

interface Degree {
  id: number;
  name: string;
}
export function DegreesManager() {
  const { t } = useLocale();
  const [entries, setEntries] = useState<Degree[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Degree | null | undefined>();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Degree | null>(null);
  const [normalizationSource, setNormalizationSource] = useState<Degree | null>(null);
  const [normalizationTargetId, setNormalizationTargetId] = useState("");
  const [normalizing, setNormalizing] = useState(false);
  const [normalizationError, setNormalizationError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<{ degrees: Degree[] }>("/api/public/degrees", {
        query: { q: search.trim() || undefined },
      });
      setEntries(result.degrees);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t("couldNotLoadDirectory"));
    } finally {
      setLoading(false);
    }
  }, [search, t]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);
  const openEditor = (degree: Degree | null) => {
    setEditing(degree);
    setName(degree?.name ?? "");
  };
  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.patch(`/api/degrees/${editing.id}`, { name });
      else await api.post("/api/degrees", { name });
      toast.success(t("degreeSaved"), { compactTitle: t("toastSaveDegree") });
      setEditing(undefined);
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : t("couldNotSaveDegree"),
        t("toastSaveDegree"),
      );
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setSaving(true);
    try {
      await api.delete(`/api/degrees/${deleting.id}`);
      toast.success(t("degreeDeleted"), { compactTitle: t("toastDeleteDegree") });
      setDeleting(null);
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : t("couldNotDeleteDegree"),
        t("toastDeleteDegree"),
      );
    } finally {
      setSaving(false);
    }
  }
  async function normalizeDegree() {
    if (!normalizationSource || !normalizationTargetId) {
      setNormalizationError(t("chooseDegreeToKeep"));
      return;
    }
    if (normalizationTargetId === String(normalizationSource.id)) {
      setNormalizationError(t("chooseDifferentDegree"));
      return;
    }
    setNormalizing(true);
    setNormalizationError(null);
    try {
      await api.post(`/api/degrees/${normalizationSource.id}/normalize`, {
        targetId: Number(normalizationTargetId),
      });
      toast.success(t("degreesNormalized"), { compactTitle: t("toastSaveDegree") });
      setNormalizationSource(null);
      setNormalizationTargetId("");
      await load();
    } catch (cause) {
      setNormalizationError(
        cause instanceof ApiError ? cause.message : t("couldNotNormalizeDegrees"),
      );
    } finally {
      setNormalizing(false);
    }
  }
  const columns: Column<Degree>[] = [
    {
      id: "name",
      header: t("name"),
      sortValue: (row) => row.name.toLowerCase(),
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
  ];
  return (
    <div className="space-y-4">
      <LibraryToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel={t("searchDegreesPlaceholder")}
        count={entries.length}
        addLabel={t("addDegree")}
        onAdd={() => openEditor(null)}
      />
      <DataTable
        columns={columns}
        data={entries}
        getRowId={(row) => String(row.id)}
        loading={loading}
        filteredEmpty={{ active: search.trim().length > 0, onClear: () => setSearch("") }}
        error={error ? { message: error, onRetry: load } : undefined}
        empty={{ icon: GraduationCapIcon, title: t("noDegreesYetTitle") }}
        rowActions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <DotsThreeIcon aria-hidden="true" />
                <span className="sr-only">{t("openMenuAria")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openEditor(row)}>{t("rename")}</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setNormalizationSource(row);
                  setNormalizationTargetId("");
                  setNormalizationError(null);
                }}
              >
                {t("normalizeDegree")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(row)}>
                {t("deleteAction")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />
      <SidePanelEditor
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        icon={GraduationCapIcon}
        title={editing ? t("renameDegreeTitle") : t("newDegreeTitle")}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEditing(undefined)}>
              {t("cancel")}
            </Button>
            <SubmitButton pending={saving} onClick={save}>
              {t("saveChanges")}
            </SubmitButton>
          </>
        }
      >
        <div className="space-y-2">
          <Label htmlFor="degree-name">{t("name")}</Label>
          <Input id="degree-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
      </SidePanelEditor>
      <AlertModal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteDegreeTitle")}
        description={deleting ? t("removeFromDirectoryInline", { name: deleting.name }) : ""}
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteAction")}
        destructive
        pending={saving}
        onConfirm={remove}
      />
      <AlertModal
        open={normalizationSource !== null}
        onOpenChange={(open) => {
          if (!open && !normalizing) {
            setNormalizationSource(null);
            setNormalizationTargetId("");
            setNormalizationError(null);
          }
        }}
        title={t("normalizeDegreeTitle")}
        description={
          normalizationSource ? t("normalizeDegreeDesc", { name: normalizationSource.name }) : ""
        }
        cancelLabel={t("cancel")}
        confirmLabel={t("normalizeDegree")}
        destructive
        pending={normalizing}
        onConfirm={normalizeDegree}
      >
        <div className="space-y-2">
          <label htmlFor="degree-normalization-target" className="text-sm font-medium">
            {t("degreeToKeep")}
          </label>
          <DegreePicker
            id="degree-normalization-target"
            value={normalizationTargetId}
            onChange={(value) => {
              setNormalizationTargetId(value);
              setNormalizationError(null);
            }}
            inDialog
          />
          {normalizationError && (
            <p role="alert" className="text-destructive text-sm">
              {normalizationError}
            </p>
          )}
        </div>
      </AlertModal>
    </div>
  );
}
