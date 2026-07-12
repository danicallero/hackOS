"use client";

// University directory manager (H12), rendered inside the Libraries page's tab.
// The shared list backing the "university" application field's autocomplete.
// Applicants can propose additions from the form; admins curate them here. There
// is no admin GET — we list via the public search endpoint — and mutate via the
// guarded POST/DELETE /api/universities (capability INTOLERANCES_MANAGE).

import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import { GraduationCapIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import type { Column } from "@/components/common/data-table";
import { DataTable } from "@/components/common/data-table";
import { Modal } from "@/components/common/modal";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

interface University {
  id: number;
  name: string;
}

const FORM_ID = "university-form";
const schema = z.object({ name: z.string().min(1, "Required").max(200) });
type Values = z.infer<typeof schema>;

export function UniversitiesManager() {
  const { t } = useLocale();
  const [entries, setEntries] = useState<University[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // `undefined` => closed; `null` => create; a row => edit.
  const [editing, setEditing] = useState<University | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<University | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: "" } });
  const { reset } = form;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { universities } = await api.get<{ universities: University[] }>(
        "/api/public/universities",
        { query: { q: search.trim() || undefined } },
      );
      setEntries(universities);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadDirectory"));
    } finally {
      setLoading(false);
    }
  }, [search, t]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // edits the universities library elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // Debounce so the server search doesn't fire on every keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    const handle = setTimeout(() => void load(), 250);
    return () => clearTimeout(handle);
  }, [load, liveRefresh]);

  const formOpen = editing !== undefined;
  useEffect(() => {
    if (editing === undefined) return;
    reset({ name: editing?.name ?? "" });
  }, [editing, reset]);

  async function onSubmit(values: Values) {
    const name = values.name.trim();
    try {
      if (editing) {
        await api.patch<University>(`/api/universities/${editing.id}`, { name });
        toast.success(t("universityRenamed"));
      } else {
        await api.post<University>("/api/universities", { name });
        toast.success(t("universityAdded"));
      }
      setEditing(undefined);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveUniversity"));
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/universities/${deleteTarget.id}`);
      toast.success(t("universityDeleted"));
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotDeleteUniversity"));
    } finally {
      setDeleting(false);
    }
  }

  const columns: Column<University>[] = [
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
        <p className="text-muted-foreground text-sm">{t("sharedDirectoryDesc")}</p>
        <Button onClick={() => setEditing(null)}>
          <PlusIcon />
          {t("newAction")}
        </Button>
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("searchUniversitiesPlaceholder")}
        className="h-9 max-w-xs"
      />

      <DataTable
        columns={columns}
        data={entries}
        getRowId={(row) => String(row.id)}
        loading={loading}
        empty={{
          icon: GraduationCapIcon,
          title: search.trim() ? t("noMatchesTitle") : t("noUniversitiesYetTitle"),
          description: search.trim() ? t("noUniversityMatchDesc") : t("addFirstOrProposeDesc"),
        }}
        rowActions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <MoreHorizontalIcon />
                <span className="sr-only">{t("openMenuAria")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(row)}>{t("rename")}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(row)}>
                {t("deleteAction")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      {/* Create / rename */}
      <Modal
        open={formOpen}
        onOpenChange={(o) => !o && setEditing(undefined)}
        icon={GraduationCapIcon}
        title={editing ? t("renameUniversityTitle") : t("newUniversityTitle")}
        description={editing ? t("updateInstitutionNameDesc") : t("addInstitutionDesc")}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEditing(undefined)}>
              {t("cancel")}
            </Button>
            <SubmitButton form={FORM_ID} pending={form.formState.isSubmitting}>
              {editing ? t("saveChanges") : t("addUniversity")}
            </SubmitButton>
          </>
        }
      >
        <Form {...form}>
          <form id={FORM_ID} onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("name")}</FormLabel>
                  <FormControl>
                    <Input placeholder="Universidade de Santiago de Compostela" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("deleteUniversityTitle")}
        description={
          deleteTarget ? t("removeFromDirectoryInline", { name: deleteTarget.name }) : undefined
        }
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={onDelete}>
              {t("deleteAction")}
            </Button>
          </>
        }
      >
        <span className="sr-only">{t("confirmDeletionAria")}</span>
      </Modal>
    </div>
  );
}
