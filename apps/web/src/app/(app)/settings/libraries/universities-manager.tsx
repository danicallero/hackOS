"use client";

// University directory manager (H12), rendered inside the Libraries page's tab.
// The shared list backing the "university" application field's autocomplete.
// Applicants can propose additions from the form; admins curate them here. There
// is no admin GET — we list via the public search endpoint — and mutate via the
// guarded POST/DELETE /api/universities (capability INTOLERANCES_MANAGE).

import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { GraduationCapIcon } from "@phosphor-icons/react/dist/csr/GraduationCap";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AlertModal } from "@/components/common/alert-modal";
import type { Column } from "@/components/common/data-table";
import { DataTable } from "@/components/common/data-table";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { SubmitButton } from "@/components/common/submit-button";
import { UniversityPicker } from "@/components/common/university-picker";
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
import { useBackgroundRefresh } from "@/hooks/use-background-refresh";
import { ApiError, api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { LibraryToolbar } from "./library-toolbar";

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
  const { succeeded, failed, hasLoaded, stale, retryNonce } = useBackgroundRefresh();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // `undefined` => closed; `null` => create; a row => edit.
  const [editing, setEditing] = useState<University | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<University | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [normalizationSource, setNormalizationSource] = useState<University | null>(null);
  const [normalizationTargetId, setNormalizationTargetId] = useState("");
  const [normalizing, setNormalizing] = useState(false);
  const [normalizationError, setNormalizationError] = useState<string | null>(null);

  const form = useForm<Values>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });
  const { reset } = form;

  const load = useCallback(async () => {
    if (!hasLoaded()) setLoading(true);
    try {
      const { universities } = await api.get<{ universities: University[] }>(
        "/api/public/universities",
        { query: { q: search.trim() || undefined } },
      );
      succeeded();
      setLoadError(null);
      setEntries(universities);
    } catch (err) {
      // A failed background refresh keeps the list (#1012).
      if (!failed(err)) return;
      setLoadError(apiErrorText(err, t, t("couldNotLoadDirectory")));
    } finally {
      setLoading(false);
    }
  }, [search, t, succeeded, failed, hasLoaded]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // edits the universities library elsewhere.
  const liveRefresh = useAutoRefresh(domainScope(SSE_TOPICS.LOGISTICS), [EVENTS.DOMAIN_CHANGED]);

  // Debounce so the server search doesn't fire on every keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    const handle = setTimeout(() => void load(), 250);
    return () => clearTimeout(handle);
  }, [load, liveRefresh, retryNonce]);

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
        toast.success(t("universityRenamed"), { compactTitle: t("toastSaveUniversity") });
      } else {
        await api.post<University>("/api/universities", { name });
        toast.success(t("universityAdded"), { compactTitle: t("toastSaveUniversity") });
      }
      setEditing(undefined);
      await load();
    } catch (err) {
      toast.error(apiErrorText(err, t, t("couldNotSaveUniversity")), t("toastSaveUniversity"));
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/universities/${deleteTarget.id}`);
      toast.success(t("universityDeleted"), { compactTitle: t("deleteUniversityTitle") });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError &&
          (err.details as { reason?: string } | undefined)?.reason === "university_in_use"
          ? t("universityInUse")
          : apiErrorText(err, t, t("couldNotDeleteUniversity")),
        t("deleteUniversityTitle"),
      );
    } finally {
      setDeleting(false);
    }
  }

  async function onNormalize() {
    if (!normalizationSource || !normalizationTargetId) {
      setNormalizationError(t("chooseUniversityToKeep"));
      return;
    }
    if (normalizationTargetId === String(normalizationSource.id)) {
      setNormalizationError(t("chooseDifferentUniversity"));
      return;
    }
    setNormalizing(true);
    setNormalizationError(null);
    try {
      await api.post(`/api/universities/${normalizationSource.id}/normalize`, {
        targetId: Number(normalizationTargetId),
      });
      toast.success(t("universitiesNormalized"), { compactTitle: t("normalizeUniversityTitle") });
      setNormalizationSource(null);
      setNormalizationTargetId("");
      await load();
    } catch (err) {
      setNormalizationError(apiErrorText(err, t, t("couldNotNormalizeUniversities")));
    } finally {
      setNormalizing(false);
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
      {stale && <StaleDataNotice onRetry={() => void load()} />}
      <LibraryToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel={t("searchUniversitiesPlaceholder")}
        count={entries.length}
        addLabel={t("addUniversity")}
        onAdd={() => setEditing(null)}
      />

      <DataTable
        columns={columns}
        data={entries}
        getRowId={(row) => String(row.id)}
        loading={loading && !hasLoaded()}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        filteredEmpty={{
          active: search.trim().length > 0,
          onClear: () => {
            setSearch("");
          },
        }}
        empty={{
          icon: GraduationCapIcon,
          title: search.trim() ? t("noMatchesTitle") : t("noUniversitiesYetTitle"),
        }}
        rowActions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <DotsThreeIcon aria-hidden="true" />
                <span className="sr-only">{t("openMenuAria")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(row)}>{t("rename")}</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setNormalizationSource(row);
                  setNormalizationTargetId("");
                  setNormalizationError(null);
                }}
              >
                {t("normalizeUniversity")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(row)}>
                {t("deleteAction")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      {/* Create / rename */}
      <SidePanelEditor
        open={formOpen}
        onOpenChange={(o) => !o && setEditing(undefined)}
        icon={GraduationCapIcon}
        title={editing ? t("renameUniversityTitle") : t("newUniversityTitle")}
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
                    <Input placeholder={t("universityNamePlaceholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </SidePanelEditor>

      {/* Delete confirm */}
      <AlertModal
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("deleteUniversityTitle")}
        description={
          deleteTarget ? t("removeFromDirectoryInline", { name: deleteTarget.name }) : ""
        }
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteAction")}
        destructive
        pending={deleting}
        onConfirm={onDelete}
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
        title={t("normalizeUniversityTitle")}
        description={
          normalizationSource
            ? t("normalizeUniversityDesc", { name: normalizationSource.name })
            : ""
        }
        cancelLabel={t("cancel")}
        confirmLabel={t("normalizeUniversity")}
        destructive
        pending={normalizing}
        onConfirm={onNormalize}
      >
        <div className="space-y-2">
          <label htmlFor="university-normalization-target" className="text-sm font-medium">
            {t("universityToKeep")}
          </label>
          <UniversityPicker
            id="university-normalization-target"
            value={normalizationTargetId}
            onChange={(value) => {
              setNormalizationTargetId(value);
              setNormalizationError(null);
            }}
            allowPropose={false}
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
