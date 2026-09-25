"use client";

// Curated degree directory: same self-service proposal limits as universities,
// with staff create, rename and deletion controls in the shared Libraries area.
import { GraduationCapIcon, MoreHorizontalIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import type { Column } from "@/components/common/data-table";
import { DataTable } from "@/components/common/data-table";
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
      toast.success(t("degreeSaved"));
      setEditing(undefined);
      await load();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : t("couldNotSaveDegree"));
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setSaving(true);
    try {
      await api.delete(`/api/degrees/${deleting.id}`);
      toast.success(t("degreeDeleted"));
      setDeleting(null);
      await load();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : t("couldNotDeleteDegree"));
    } finally {
      setSaving(false);
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
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">{t("degreesDirectoryDesc")}</p>
        <Button onClick={() => openEditor(null)}>
          <PlusIcon />
          {t("newAction")}
        </Button>
      </div>
      <div className="relative max-w-xs">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("searchDegreesPlaceholder")}
          className="pl-9"
        />
      </div>
      <DataTable
        columns={columns}
        data={entries}
        getRowId={(row) => String(row.id)}
        loading={loading}
        error={error ? { message: error, onRetry: load } : undefined}
        empty={{ icon: GraduationCapIcon, title: t("noDegreesYetTitle") }}
        rowActions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreHorizontalIcon />
                <span className="sr-only">{t("openMenuAria")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openEditor(row)}>{t("rename")}</DropdownMenuItem>
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
    </div>
  );
}
