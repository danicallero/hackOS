"use client";

// University directory (H12). The shared list backing the "university" application
// field's autocomplete. Applicants can propose additions from the form; admins
// curate them here. There is no admin GET — we list via the public search
// endpoint — and mutate via the guarded POST/DELETE /api/universities
// (capability INTOLERANCES_MANAGE, shared with the food-intolerance dictionary).

import { zodResolver } from "@hookform/resolvers/zod";
import { GraduationCapIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import type { Column } from "@/components/common/data-table";
import { DataTable } from "@/components/common/data-table";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
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

export default function UniversitiesSettingsPage() {
  const [entries, setEntries] = useState<University[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
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

  useEffect(() => {
    if (createOpen) reset({ name: "" });
  }, [createOpen, reset]);

  async function onSubmit(values: Values) {
    try {
      await api.post<University>("/api/universities", { name: values.name.trim() });
      toast.success("University added.");
      setCreateOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add the university.");
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
    <div className="space-y-6">
      <PageHeader
        title="Universities"
        description="The shared directory backing the university picker on application forms. Applicants can propose new ones; you curate them here."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            New
          </Button>
        }
      />

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
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(row)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      {/* Create */}
      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        icon={GraduationCapIcon}
        title="New university"
        description="Add an institution to the shared directory."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <SubmitButton form={FORM_ID} pending={form.formState.isSubmitting}>
              Add university
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
