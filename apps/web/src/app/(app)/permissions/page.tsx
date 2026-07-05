"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon, LayersIcon, PlusIcon, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { type Column, DataTable } from "@/components/common/data-table";
import { Modal } from "@/components/common/modal";
import { MultiSelect } from "@/components/common/multi-select";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import type { PermissionGroupDetail, PermissionGroupSummary } from "@/lib/types";
import { CAPABILITY_OPTIONS, capabilitiesByDomain, prettifyCapability } from "./helpers";

// H8: admins manage capability groups. This page lists groups, offers a
// create-group modal and shows the read-only catalogue of every capability kind.

const createSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  description: z.string().max(2000),
  capabilities: z.array(z.string()),
});

type CreateValues = z.infer<typeof createSchema>;

export default function PermissionsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<PermissionGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", description: "", capabilities: [] },
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get<PermissionGroupSummary[]>("/api/permission-groups");
      setGroups(rows);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load permission groups.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate(values: CreateValues) {
    try {
      const group = await api.post<PermissionGroupDetail>("/api/permission-groups", {
        name: values.name,
        description: values.description || undefined,
        capabilities: values.capabilities,
      });
      toast.success("Group created.");
      setCreateOpen(false);
      form.reset({ name: "", description: "", capabilities: [] });
      router.push(`/permissions/${group.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the group.");
    }
  }

  const columns: Column<PermissionGroupSummary>[] = [
    {
      id: "name",
      header: "Name",
      cell: (g) => <span className="font-medium">{g.name}</span>,
      sortValue: (g) => g.name,
    },
    {
      id: "description",
      header: "Description",
      cell: (g) =>
        g.description ? (
          <span className="text-muted-foreground">{g.description}</span>
        ) : (
          <span className="text-muted-foreground/60 italic">No description</span>
        ),
    },
  ];

  const catalogue = capabilitiesByDomain();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Permissions"
        description="Groups grant sets of capabilities and can include other groups (H8)."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon /> New group
          </Button>
        }
      />

      <SectionCard
        icon={ShieldCheckIcon}
        title="Permission groups"
        description="Click a group to edit its capabilities, members and nested groups."
        bodyClassName="p-0"
      >
        <DataTable
          columns={columns}
          data={groups}
          getRowId={(g) => String(g.id)}
          loading={loading}
          searchable={(g) => `${g.name} ${g.description ?? ""}`}
          searchPlaceholder="Filter groups…"
          pageSize={10}
          onRowClick={(g) => router.push(`/permissions/${g.id}`)}
          empty={{
            icon: ShieldCheckIcon,
            title: "No permission groups yet",
            description: "Create a group to start assigning capabilities.",
          }}
        />
      </SectionCard>

      <SectionCard
        icon={LayersIcon}
        title="Capabilities catalogue"
        description="Every capability kind there is, grouped by domain. Read-only reference."
      >
        <div className="space-y-5">
          {catalogue.map((group) => (
            <div key={group.domain} className="space-y-2">
              <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {group.domain}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.capabilities.map((cap) => (
                  <StatusBadge key={cap} tone={cap === "*" ? "brand" : "neutral"} dot={false}>
                    <span className="font-mono">{cap}</span>
                    <span className="text-muted-foreground">· {prettifyCapability(cap)}</span>
                  </StatusBadge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        icon={KeyRoundIcon}
        title="New permission group"
        description="Give it a name and, optionally, the capabilities it grants."
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <SubmitButton form="create-group-form" pending={form.formState.isSubmitting}>
              Create group
            </SubmitButton>
          </>
        }
      >
        <Form {...form}>
          <form id="create-group-form" onSubmit={form.handleSubmit(onCreate)} className="space-y-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Judges" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="What this group is for…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="capabilities"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Capabilities</FormLabel>
                  <FormControl>
                    <MultiSelect
                      options={CAPABILITY_OPTIONS}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Select capabilities…"
                      searchPlaceholder="Search capabilities…"
                      emptyText="No matching capability."
                    />
                  </FormControl>
                  <FormDescription>You can also change these later.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </Modal>
    </div>
  );
}
