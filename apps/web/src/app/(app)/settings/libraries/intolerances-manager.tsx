"use client";

// Food-intolerance dictionary manager (H12/H25), rendered inside the Libraries
// page's tab. Admins maintain the shared, i18n catalogue used by the
// registration/profile pickers and the application dietary field. There is no
// admin GET — we list via the public endpoint — and mutate via the guarded
// POST/PATCH/DELETE /api/food-intolerances (capability INTOLERANCES_MANAGE).

import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { ForkKnifeIcon } from "@phosphor-icons/react/dist/csr/ForkKnife";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
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
import { pickText, useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { Intolerance } from "@/lib/types";
import { LibraryToolbar } from "./library-toolbar";

const FORM_ID = "intolerance-form";

// i18nTextSchema requires all three locales for a label. Descriptions are
// optional but all-or-nothing: the API rejects a partial {en,es,gl}.
const schema = z
  .object({
    label: z.object({
      en: z.string().min(1, "Required").max(200),
      es: z.string().min(1, "Required").max(200),
      gl: z.string().min(1, "Required").max(200),
    }),
    description: z.object({
      en: z.string().max(1000),
      es: z.string().max(1000),
      gl: z.string().max(1000),
    }),
  })
  .superRefine((v, ctx) => {
    const d = v.description;
    const filled = [d.en, d.es, d.gl].filter((s) => s.trim().length > 0).length;
    if (filled > 0 && filled < 3) {
      for (const k of ["en", "es", "gl"] as const) {
        if (!d[k].trim()) {
          ctx.addIssue({
            code: "custom",
            message: "Fill every locale or leave the description blank",
            path: ["description", k],
          });
        }
      }
    }
  });

type Values = z.infer<typeof schema>;

const EMPTY: Values = {
  label: { en: "", es: "", gl: "" },
  description: { en: "", es: "", gl: "" },
};

export function IntolerancesManager() {
  const { t } = useLocale();
  const [entries, setEntries] = useState<Intolerance[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // `null` => closed; a partial with no id => create; with id => edit.
  const [editing, setEditing] = useState<Intolerance | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Intolerance | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const { reset } = form;

  const load = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    setLoadError(null);
    try {
      const { intolerances } = await api.get<{ intolerances: Intolerance[] }>(
        "/api/public/food-intolerances",
      );
      hasLoadedRef.current = true;
      setEntries(intolerances);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotLoadDictionary");
      setLoadError(message);
      toast.error(message, t("toastDietaryNeeds"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // edits the intolerances library elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=logistics", [EVENTS.DOMAIN_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, liveRefresh]);

  // Prime the form whenever the create/edit modal opens.
  const formOpen = editing !== undefined;

  useEffect(() => {
    if (editing === undefined) return;
    if (editing === null) {
      reset(EMPTY);
    } else {
      reset({
        label: { ...editing.label },
        description: editing.description ? { ...editing.description } : { en: "", es: "", gl: "" },
      });
    }
  }, [editing, reset]);

  async function onSubmit(values: Values) {
    const d = values.description;
    const anyDesc = [d.en, d.es, d.gl].some((s) => s.trim().length > 0);
    const payload = {
      label: {
        en: values.label.en.trim(),
        es: values.label.es.trim(),
        gl: values.label.gl.trim(),
      },
      // Send null (not a partial) when blank — the schema requires all three otherwise.
      description: anyDesc ? { en: d.en.trim(), es: d.es.trim(), gl: d.gl.trim() } : null,
    };
    try {
      if (editing) {
        await api.patch<Intolerance>(`/api/food-intolerances/${editing.id}`, payload);
        toast.success(t("intoleranceUpdated"), { compactTitle: t("toastSaveDietaryNeed") });
      } else {
        await api.post<Intolerance>("/api/food-intolerances", payload);
        toast.success(t("intoleranceAdded"), { compactTitle: t("toastSaveDietaryNeed") });
      }
      setEditing(undefined);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotSaveEntry"),
        t("toastSaveDietaryNeed"),
      );
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/food-intolerances/${deleteTarget.id}`);
      toast.success(t("intoleranceDeleted"), { compactTitle: t("toastDeleteDietaryNeed") });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotDeleteEntry"),
        t("toastDeleteDietaryNeed"),
      );
    } finally {
      setDeleting(false);
    }
  }

  const columns: Column<Intolerance>[] = [
    {
      id: "label",
      header: t("labelField"),
      sortValue: (row) => pickText(row.label, "es").toLowerCase(),
      cell: (row) => (
        <div className="space-y-0.5">
          <div className="font-medium">{pickText(row.label, "es")}</div>
          <div className="text-muted-foreground text-xs">
            EN {row.label.en} · GL {row.label.gl}
          </div>
        </div>
      ),
    },
    {
      id: "description",
      header: t("descriptionLabel"),
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.description ? pickText(row.description, "es") : "—"}
        </span>
      ),
    },
  ];

  const query = search.trim().toLowerCase();
  const filteredEntries = entries.filter((row) =>
    `${pickText(row.label, "es")} ${row.label.en} ${row.label.gl}`.toLowerCase().includes(query),
  );

  return (
    <div className="space-y-4">
      <LibraryToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel={t("searchIntolerances")}
        count={filteredEntries.length}
        addLabel={t("addIntolerance")}
        onAdd={() => setEditing(null)}
      />
      <DataTable
        columns={columns}
        data={filteredEntries}
        getRowId={(row) => String(row.id)}
        loading={loading && !hasLoadedRef.current}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        filteredEmpty={{ active: query.length > 0, onClear: () => setSearch("") }}
        empty={{
          icon: ForkKnifeIcon,
          title: t("noIntolerancesYetTitle"),
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
              <DropdownMenuItem onSelect={() => setEditing(row)}>{t("edit")}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(row)}>
                {t("deleteAction")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      {/* Create / edit */}
      <SidePanelEditor
        open={formOpen}
        onOpenChange={(o) => !o && setEditing(undefined)}
        icon={ForkKnifeIcon}
        title={editing ? t("editIntoleranceTitle") : t("newIntoleranceTitle")}
        description={t("provideLabelEveryLocaleDesc")}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEditing(undefined)}>
              {t("cancel")}
            </Button>
            <SubmitButton form={FORM_ID} pending={form.formState.isSubmitting}>
              {editing ? t("saveChanges") : t("addIntolerance")}
            </SubmitButton>
          </>
        }
      >
        <Form {...form}>
          <form id={FORM_ID} onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-3">
              <p className="text-sm font-medium">{t("labelField")}</p>
              {(["es", "en", "gl"] as const).map((loc) => (
                <FormField
                  key={loc}
                  control={form.control}
                  name={`label.${loc}` as const}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-muted-foreground text-xs uppercase">
                        {loc}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">{t("descriptionOptionalLabel")}</p>
              {(["es", "en", "gl"] as const).map((loc) => (
                <FormField
                  key={loc}
                  control={form.control}
                  name={`description.${loc}` as const}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-muted-foreground text-xs uppercase">
                        {loc}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
          </form>
        </Form>
      </SidePanelEditor>

      {/* Delete confirm */}
      <AlertModal
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("deleteIntoleranceTitle")}
        description={
          deleteTarget
            ? t("removeFromDictionaryInline", { label: pickText(deleteTarget.label, "es") })
            : ""
        }
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteAction")}
        destructive
        pending={deleting}
        onConfirm={onDelete}
      />
    </div>
  );
}
