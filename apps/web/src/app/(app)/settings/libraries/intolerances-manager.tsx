"use client";

// Food-intolerance dictionary manager (H12/H25), rendered inside the Libraries
// page's tab. Admins maintain the shared, i18n catalogue used by the
// registration/profile pickers and the application dietary field. There is no
// admin GET — we list via the public endpoint — and mutate via the guarded
// POST/PATCH/DELETE /api/food-intolerances (capability INTOLERANCES_MANAGE).

import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import { MoreHorizontalIcon, PlusIcon, UtensilsCrossedIcon } from "lucide-react";
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
import { pickText } from "@/lib/i18n";
import type { Intolerance } from "@/lib/types";

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
  const [entries, setEntries] = useState<Intolerance[]>([]);
  const [loading, setLoading] = useState(true);
  // `null` => closed; a partial with no id => create; with id => edit.
  const [editing, setEditing] = useState<Intolerance | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Intolerance | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const { reset } = form;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { intolerances } = await api.get<{ intolerances: Intolerance[] }>(
        "/api/public/food-intolerances",
      );
      setEntries(intolerances);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load the dictionary.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Soft, in-place refresh instead of a hard reload when another admin
  // edits the intolerances library elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
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
        toast.success("Intolerance updated.");
      } else {
        await api.post<Intolerance>("/api/food-intolerances", payload);
        toast.success("Intolerance added.");
      }
      setEditing(undefined);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the entry.");
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/food-intolerances/${deleteTarget.id}`);
      toast.success("Intolerance deleted.");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the entry.");
    } finally {
      setDeleting(false);
    }
  }

  const columns: Column<Intolerance>[] = [
    {
      id: "label",
      header: "Label",
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
      header: "Description",
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.description ? pickText(row.description, "es") : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          The shared, translatable catalogue used by the registration and profile pickers and the
          application dietary field.
        </p>
        <Button onClick={() => setEditing(null)}>
          <PlusIcon />
          New
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={entries}
        getRowId={(row) => String(row.id)}
        loading={loading}
        searchable={(row) => `${pickText(row.label, "es")} ${row.label.en} ${row.label.gl}`}
        searchPlaceholder="Search intolerances…"
        empty={{
          icon: UtensilsCrossedIcon,
          title: "No intolerances yet",
          description: "Add the first entry so participants can pick it during registration.",
        }}
        rowActions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <MoreHorizontalIcon />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(row)}>Edit</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(row)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      {/* Create / edit */}
      <Modal
        open={formOpen}
        onOpenChange={(o) => !o && setEditing(undefined)}
        icon={UtensilsCrossedIcon}
        title={editing ? "Edit intolerance" : "New intolerance"}
        description="Provide the label in every locale. The description is optional but all-or-nothing."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEditing(undefined)}>
              Cancel
            </Button>
            <SubmitButton form={FORM_ID} pending={form.formState.isSubmitting}>
              {editing ? "Save changes" : "Add intolerance"}
            </SubmitButton>
          </>
        }
      >
        <Form {...form}>
          <form id={FORM_ID} onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-3">
              <p className="text-sm font-medium">Label</p>
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
              <p className="text-sm font-medium">Description (optional)</p>
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
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete intolerance"
        description={
          deleteTarget
            ? `Remove "${pickText(deleteTarget.label, "es")}" from the dictionary? Existing participant selections keep their id but stop resolving.`
            : undefined
        }
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={onDelete}>
              Delete
            </Button>
          </>
        }
      >
        <span className="sr-only">Confirm deletion</span>
      </Modal>
    </div>
  );
}
