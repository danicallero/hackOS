"use client";

// Enterprises directory (H43/H44): admins with sponsors:manage list every
// sponsor enterprise and create new ones. An enterprise is created up-front so
// it can be referenced when inviting a sponsor rep, who auto-links to it on
// acceptance. Row click drills into the edit page.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2Icon, EyeIcon, EyeOffIcon, LockIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { ScheduledDateTimeField } from "@/components/common/scheduled-datetime-field";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { fromDatetimeLocal } from "@/lib/datetime";
import { useCan, useMe } from "@/lib/session";
import { type Enterprise, initials, isScheduled, visibilityTone } from "./shared";

// Optional URL: allow blank, otherwise must be a valid URL.
const optionalUrl = z.string().url("Enter a valid URL").or(z.literal(""));
// Optional positive integer typed as text so the input can be cleared.
const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

const createSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  website: optionalUrl,
  logoUrl: optionalUrl,
  logoNegativeUrl: optionalUrl,
  description: z.string().max(2000),
  tierId: optionalPositiveInt,
  displayPriority: optionalPositiveInt,
  visibility: z.enum(["visible", "hidden"]),
  availableFrom: z.string(),
});
type CreateValues = z.infer<typeof createSchema>;

const columns: Column<Enterprise>[] = [
  {
    id: "name",
    header: "Enterprise",
    sortValue: (e) => e.name.toLowerCase(),
    cell: (e) => (
      <div className="flex items-center gap-3">
        <Avatar size="sm">
          {e.logo_url ? (
            <SponsorLogo
              logoUrl={e.logo_url}
              logoNegativeUrl={e.logo_negative_url}
              alt={e.name}
              className="size-full object-contain"
            />
          ) : (
            <AvatarFallback>{initials(e.name)}</AvatarFallback>
          )}
        </Avatar>
        <span className="font-medium">{e.name}</span>
      </div>
    ),
  },
  {
    id: "website",
    header: "Website",
    cell: (e) =>
      e.website ? (
        <span className="text-muted-foreground text-sm">
          {e.website.replace(/^https?:\/\//, "")}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "visibility",
    header: "Visibility",
    sortValue: (e) => e.visibility,
    cell: (e) => (
      <StatusBadge tone={visibilityTone(e.visibility)} className="capitalize">
        {e.visibility}
      </StatusBadge>
    ),
  },
  {
    id: "reveal",
    header: "Reveal",
    sortValue: (e) => e.available_from ?? "",
    cell: (e) => {
      if (isScheduled(e.available_from)) {
        return (
          <div className="flex items-center gap-2">
            <StatusBadge tone="warning">Scheduled</StatusBadge>
            <span className="text-muted-foreground text-sm">
              {new Date(e.available_from as string).toLocaleString()}
            </span>
          </div>
        );
      }
      if (e.visibility === "visible") {
        return (
          <span className="text-muted-foreground text-sm">
            {e.available_from ? new Date(e.available_from).toLocaleString() : "Immediate"}
          </span>
        );
      }
      return <span className="text-muted-foreground">—</span>;
    },
  },
  {
    id: "priority",
    header: "Priority",
    align: "right",
    sortValue: (e) => e.display_priority ?? Number.POSITIVE_INFINITY,
    cell: (e) =>
      e.display_priority != null ? (
        <span className="text-sm">{e.display_priority}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

export default function EnterprisesPage() {
  const router = useRouter();
  const canManage = useCan(CAPABILITIES.SPONSORS_MANAGE);
  const me = useMe();
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ enterprises: Enterprise[] }>("/api/enterprises");
      setEnterprises(r.enterprises);
      setSelectedIds(new Set());
    } catch (err) {
      setEnterprises([]);
      toast.error(err instanceof ApiError ? err.message : "Could not load enterprises.");
    } finally {
      setLoading(false);
    }
  }, []);

  const bulkVisibility = useCallback(
    async (visible: boolean) => {
      const ids = [...selectedIds].map(Number);
      if (ids.length === 0) return;
      setBulkBusy(true);
      try {
        await api.post("/api/enterprises/visibility", { ids, visible });
        toast.success(
          visible
            ? `Made ${ids.length} enterprise${ids.length > 1 ? "s" : ""} visible.`
            : `Hid ${ids.length} enterprise${ids.length > 1 ? "s" : ""}.`,
        );
        await load();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Could not update visibility.");
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedIds, load],
  );

  // Soft, in-place refresh instead of a hard reload when another admin
  // creates/edits an enterprise elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (canManage) {
      void load();
      return;
    }
    if (me?.role !== "sponsor") {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .get<Enterprise>("/api/enterprises/mine")
      .then((enterprise) => {
        if (alive) router.replace(`/enterprises/${enterprise.id}`);
      })
      .catch((err) => {
        if (!alive) return;
        toast.error(err instanceof ApiError ? err.message : "Could not load your enterprise.");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [canManage, load, me?.role, router, liveRefresh]);

  if (!canManage && me?.role === "sponsor" && loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="My enterprise" />
        <DataTable
          columns={columns}
          data={[]}
          getRowId={(e) => String(e.id)}
          loading
          empty={{ icon: Building2Icon, title: "Loading enterprise" }}
        />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader title="Enterprises" />
        <EmptyState
          icon={LockIcon}
          title="You can't manage sponsors"
          description="You need the sponsors:manage capability to view and manage enterprises."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Enterprises"
        description="Sponsor organisations. Create one before inviting its representatives — they auto-link on acceptance (H44)."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            New enterprise
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={enterprises}
        getRowId={(e) => String(e.id)}
        onRowClick={(e) => router.push(`/enterprises/${e.id}`)}
        searchable={(e) => `${e.name} ${e.website ?? ""}`}
        searchPlaceholder="Search enterprises…"
        pageSize={15}
        loading={loading}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        toolbar={
          selectedIds.size > 0 ? (
            <>
              <span className="text-muted-foreground text-sm">{selectedIds.size} selected</span>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy}
                onClick={() => bulkVisibility(true)}
              >
                <EyeIcon className="size-4" />
                Make visible
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy}
                onClick={() => bulkVisibility(false)}
              >
                <EyeOffIcon className="size-4" />
                Hide
              </Button>
            </>
          ) : undefined
        }
        empty={{
          icon: Building2Icon,
          title: "No enterprises yet",
          description: "Create the first sponsor enterprise to get started.",
        }}
      />

      <CreateEnterpriseModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (created) => {
          setCreateOpen(false);
          await load();
          router.push(`/enterprises/${created.id}`);
        }}
      />
    </div>
  );
}

function CreateEnterpriseModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: Enterprise) => void | Promise<void>;
}) {
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: "",
      website: "",
      logoUrl: "",
      logoNegativeUrl: "",
      description: "",
      tierId: "",
      displayPriority: "",
      visibility: "hidden",
      availableFrom: "",
    },
  });
  const { reset } = form;

  // Reset the form each time the modal opens so stale input never lingers.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  async function onSubmit(values: CreateValues) {
    try {
      // POST /api/enterprises (createEnterpriseBody). Empty strings → null so
      // optional fields are omitted; availableFrom is coerced to a Date server-side.
      const created = await api.post<Enterprise>("/api/enterprises", {
        name: values.name,
        website: values.website || null,
        logoUrl: values.logoUrl || null,
        logoNegativeUrl: values.logoNegativeUrl || null,
        description: values.description || null,
        tierId: values.tierId ? Number(values.tierId) : null,
        displayPriority: values.displayPriority ? Number(values.displayPriority) : null,
        visibility: values.visibility,
        availableFrom: fromDatetimeLocal(values.availableFrom),
      });
      toast.success("Enterprise created.");
      await onCreated(created);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the enterprise.");
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      icon={Building2Icon}
      title="New enterprise"
      description="Add a sponsor organisation. You can refine its profile and logo afterwards."
      footer={
        <SubmitButton form="create-enterprise-form" pending={form.formState.isSubmitting}>
          Create enterprise
        </SubmitButton>
      }
    >
      <Form {...form}>
        <form
          id="create-enterprise-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-5"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input placeholder="Acme Corp" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="website"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Website</FormLabel>
                <FormControl>
                  <Input type="url" placeholder="https://acme.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="logoUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Logo URL</FormLabel>
                <FormControl>
                  <Input type="url" placeholder="https://…/logo.png" {...field} />
                </FormControl>
                <FormDescription>Optional — you can also upload a logo later.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="logoNegativeUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Logo for dark backgrounds URL</FormLabel>
                <FormControl>
                  <Input type="url" placeholder="https://…/logo-negative.png" {...field} />
                </FormControl>
                <FormDescription>
                  Optional — the regular logo is used when this is blank.
                </FormDescription>
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
                  <Textarea rows={3} placeholder="What this sponsor does…" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="tierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tier ID</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="e.g. 1" {...field} />
                  </FormControl>
                  <FormDescription>Sponsor tier reference (optional).</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="displayPriority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display priority</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="1 = first" {...field} />
                  </FormControl>
                  <FormDescription>Lower shows first in the reveal.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="visibility"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Visibility</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="hidden">Hidden</SelectItem>
                    <SelectItem value="visible">Visible</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="availableFrom"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reveal from</FormLabel>
                <FormControl>
                  <ScheduledDateTimeField
                    value={field.value}
                    onChange={(value) =>
                      form.setValue("availableFrom", value, { shouldDirty: true })
                    }
                    addLabel="Add reveal time"
                    inputLabel="Reveal date and time"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Modal>
  );
}
