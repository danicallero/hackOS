"use client";

import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { useMemo, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import type { Column } from "@/components/common/data-table";
import { DataTable } from "@/components/common/data-table";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLibraryList } from "@/hooks/use-library-list";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { normalizeSearchText } from "@/lib/search-text";
import { toast } from "@/lib/toast";
import { LibraryToolbar } from "./library-toolbar";

interface Area {
  id: number;
  name: string;
  helpers: number;
  requests: number;
}

/**
 * Knowledge areas (H61): the one catalogue behind a mentor's areas and the help
 * desk's topics. Helpers add areas from their own profile; staff with
 * `helpdesk:manage` rename and merge duplicates here and delete an area nobody
 * uses (one in use is merged into another instead).
 */
export function KnowledgeManager() {
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const {
    data,
    loading,
    errorMessage: error,
    stale,
    refetch: load,
  } = useLibraryList(
    ["libraries", "knowledge"],
    async (signal) =>
      (await api.get<{ topics: Area[] }>("/api/helpdesk/topics/manage", { signal })).topics,
    "couldNotLoadKnowledge",
  );
  const all = data ?? [];
  const entries = useMemo(() => {
    const query = normalizeSearchText(search.trim());
    return query ? all.filter((area) => normalizeSearchText(area.name).includes(query)) : all;
  }, [all, search]);
  const [editing, setEditing] = useState<Area | null | undefined>();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Area | null>(null);
  const [merging, setMerging] = useState<Area | null>(null);
  const [target, setTarget] = useState("");
  const toastTitle = t("toastKnowledge");

  async function run(action: () => Promise<unknown>, success: string, failure: string) {
    setSaving(true);
    try {
      await action();
      toast.success(success, { compactTitle: toastTitle });
      load();
      return true;
    } catch (cause) {
      toast.error(apiErrorText(cause, t, failure), toastTitle);
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function save() {
    if (!editing || !name.trim()) return;
    const done = await run(
      () => api.patch(`/api/helpdesk/topics/${editing?.id}`, { name }),
      t("knowledgeSaved"),
      t("couldNotSaveKnowledge"),
    );
    if (done) setEditing(undefined);
  }
  async function remove() {
    if (!deleting) return;
    if (
      await run(
        () => api.delete(`/api/helpdesk/topics/${deleting.id}`),
        t("knowledgeDeleted"),
        t("couldNotSaveKnowledge"),
      )
    )
      setDeleting(null);
  }
  async function merge() {
    if (!merging || !target) return;
    const done = await run(
      () => api.post(`/api/helpdesk/topics/${merging.id}/merge`, { targetId: Number(target) }),
      t("knowledgeMerged"),
      t("couldNotSaveKnowledge"),
    );
    if (done) {
      setMerging(null);
      setTarget("");
    }
  }

  const columns: Column<Area>[] = [
    {
      id: "name",
      header: t("name"),
      sortValue: (row) => row.name.toLowerCase(),
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: "usage",
      header: t("knowledgeUsageColumn"),
      sortValue: (row) => row.helpers + row.requests,
      cell: (row) => (
        <span className="text-muted-foreground">
          {t("knowledgeUsage", { helpers: row.helpers, requests: row.requests })}
        </span>
      ),
    },
  ];
  return (
    <div className="space-y-4">
      {stale && <StaleDataNotice onRetry={() => load()} />}
      <LibraryToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel={t("searchKnowledgePlaceholder")}
        count={entries.length}
      />
      <DataTable
        columns={columns}
        data={entries}
        getRowId={(row) => String(row.id)}
        loading={loading}
        filteredEmpty={{ active: search.trim().length > 0, onClear: () => setSearch("") }}
        error={error ? { message: error, onRetry: () => load() } : undefined}
        empty={{ title: t("noKnowledgeYetTitle") }}
        rowActions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <DotsThreeIcon aria-hidden="true" />
                <span className="sr-only">{t("openMenuAria")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  setEditing(row);
                  setName(row.name);
                }}
              >
                {t("rename")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setMerging(row);
                  setTarget("");
                }}
              >
                {t("mergeKnowledge")}
              </DropdownMenuItem>
              {row.helpers + row.requests === 0 && (
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(row)}>
                  {t("deleteAction")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />
      <SidePanelEditor
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        icon={BrainIcon}
        title={t("renameKnowledgeTitle")}
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
          <Label htmlFor="knowledge-name">{t("name")}</Label>
          <Input
            id="knowledge-name"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      </SidePanelEditor>
      <AlertModal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteKnowledgeTitle")}
        description={deleting ? t("deleteKnowledgeDesc", { name: deleting.name }) : ""}
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteAction")}
        destructive
        pending={saving}
        onConfirm={remove}
      />
      <AlertModal
        open={merging !== null}
        onOpenChange={(open) => {
          if (!open && !saving) {
            setMerging(null);
            setTarget("");
          }
        }}
        title={t("mergeKnowledge")}
        description={merging ? t("mergeKnowledgeDesc", { name: merging.name }) : ""}
        cancelLabel={t("cancel")}
        confirmLabel={t("mergeKnowledge")}
        destructive
        pending={saving}
        onConfirm={merge}
      >
        <div className="space-y-2">
          <Label htmlFor="knowledge-target">{t("knowledgeToKeep")}</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger id="knowledge-target" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {all
                .filter((area) => area.id !== merging?.id)
                .map((area) => (
                  <SelectItem key={area.id} value={String(area.id)}>
                    {area.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </AlertModal>
    </div>
  );
}
