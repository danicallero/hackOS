"use client";

// University directory manager (H12), rendered inside the Libraries page's tab.
// The shared list backing the "university" application field's autocomplete.
// Applicants can propose additions from the form; admins curate them here. There
// is no admin GET — we list via the public search endpoint — and mutate via the
// guarded POST/DELETE /api/universities (capability INTOLERANCES_MANAGE).

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
import { ApiError, api } from "@/lib/api";

interface University {
  id: number;
  name: string;
}

const FORM_ID = "university-form";
const schema = z.object({ name: z.string().min(1, "Required").max(200) });
type Values = z.infer<typeof schema>;

export function UniversitiesManager() {
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
      toast.error(err instanceof ApiError ? err.message : "Could not load the directory.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  // Debounce so the server search doesn't fire on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => void load(), 250);
    return () => clearTimeout(handle);
  }, [load]);

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
        toast.success("University renamed.");
      } else {
        await api.post<University>("/api/universities", { name });
        toast.success("University added.");
      }
      setEditing(undefined);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the university.");
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/universities/${deleteTarget.id}`);
      toast.success("University deleted.");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the university.");
    } finally {
      setDeleting(false);
    }
  }

  const columns: Column<University>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (row) => row.name.toLowerCase(),
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          The shared directory backing the university picker on application forms. Applicants can
          propose new ones; you curate them here.
        </p>
        <Button onClick={() => setEditing(null)}>
          <PlusIcon />
          New
        </Button>
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search universities…"
        className="h-9 max-w-xs"
      />

      <DataTable
        columns={columns}
        data={entries}
        getRowId={(row) => String(row.id)}
        loading={loading}
        empty={{
          icon: GraduationCapIcon,
          title: search.trim() ? "No matches" : "No universities yet",
          description: search.trim()
            ? "No university matches this search. Add it below."
            : "Add the first entry, or let applicants propose ones from the form.",
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
              <DropdownMenuItem onSelect={() => setEditing(row)}>Rename</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(row)}>
                Delete
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
        title={editing ? "Rename university" : "New university"}
        description={
          editing
            ? "Update the institution's name. Applicant selections keep their id."
            : "Add an institution to the shared directory."
        }
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEditing(undefined)}>
              Cancel
            </Button>
            <SubmitButton form={FORM_ID} pending={form.formState.isSubmitting}>
              {editing ? "Save changes" : "Add university"}
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
                  <FormLabel>Name</FormLabel>
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
        title="Delete university"
        description={
          deleteTarget
            ? `Remove "${deleteTarget.name}" from the directory? Existing applicant selections keep their id but stop resolving.`
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
