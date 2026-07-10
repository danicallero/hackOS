"use client";

// H50 announcement administration: create/edit/delete, audience, publish/expiry
// window and current/scheduled/expired status. Gated by announcements:manage;
// consumes the CRUD API in apps/api/src/modules/notifications/routes/announcements.ts.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { LockIcon, MegaphoneIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { ScheduledDateTimeField } from "@/components/common/scheduled-datetime-field";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { formatScheduledDateTime } from "@/lib/datetime";
import { type Announcement, type AnnouncementInput, notificationsApi } from "@/lib/notifications";
import { useCan } from "@/lib/session";
import type { Tone } from "@/lib/tones";

const EMPTY_FORM: AnnouncementInput = {
  title: "",
  body: "",
  targetRole: null,
  publishAt: null,
  expiresAt: null,
};

const EVERYONE = "__everyone__";

function toForm(a: Announcement): AnnouncementInput {
  return {
    title: a.title,
    body: a.body,
    targetRole: a.target_role,
    publishAt: a.publish_at,
    expiresAt: a.expires_at,
  };
}

type AnnouncementStatus = "scheduled" | "live" | "expired";

function announcementStatus(a: Announcement): AnnouncementStatus {
  const now = Date.now();
  if (a.expires_at && new Date(a.expires_at).getTime() <= now) return "expired";
  if (a.publish_at && new Date(a.publish_at).getTime() > now) return "scheduled";
  return "live";
}

const STATUS_TONE: Record<AnnouncementStatus, Tone> = {
  scheduled: "warning",
  live: "success",
  expired: "neutral",
};

const STATUS_LABEL: Record<AnnouncementStatus, string> = {
  scheduled: "Scheduled",
  live: "Live",
  expired: "Expired",
};

function audienceLabel(targetRole: string | null): string {
  return targetRole === "participant" ? "Participants" : "Everyone";
}

export default function AnnouncementsPage() {
  const canManage = useCan(CAPABILITIES.ANNOUNCEMENTS_MANAGE);
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await notificationsApi.listAnnouncements();
      setItems(result.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load announcements.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) void load();
    else setLoading(false);
  }, [canManage, load]);

  async function remove(item: Announcement) {
    setBusy(true);
    try {
      await notificationsApi.deleteAnnouncement(item.id);
      toast.success("Announcement deleted.");
      setDeleting(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete announcement.");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader title="Announcements" />
        <EmptyState
          icon={LockIcon}
          title="You can't manage announcements"
          description="Announcements require the announcements:manage capability."
        />
      </div>
    );
  }

  const columns: Column<Announcement>[] = [
    {
      id: "title",
      header: "Announcement",
      sortValue: (a) => a.title.toLowerCase(),
      cell: (a) => (
        <div>
          <p className="font-medium">{a.title}</p>
          <p className="text-muted-foreground line-clamp-1 text-sm">{a.body}</p>
        </div>
      ),
    },
    {
      id: "audience",
      header: "Audience",
      sortValue: (a) => audienceLabel(a.target_role),
      cell: (a) => <StatusBadge tone="neutral">{audienceLabel(a.target_role)}</StatusBadge>,
    },
    {
      id: "status",
      header: "Status",
      sortValue: (a) => announcementStatus(a),
      cell: (a) => {
        const status = announcementStatus(a);
        return <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>;
      },
    },
    {
      id: "window",
      header: "Window",
      sortValue: (a) => a.publish_at ?? "",
      cell: (a) => (
        <span className="text-muted-foreground text-xs">
          {a.publish_at ? formatScheduledDateTime(a.publish_at) : "Immediate"}
          {" → "}
          {a.expires_at ? formatScheduledDateTime(a.expires_at) : "No end"}
        </span>
      ),
    },
    {
      id: "created",
      header: "Created",
      sortValue: (a) => a.created_at,
      cell: (a) => (
        <span className="text-muted-foreground text-xs">
          {formatScheduledDateTime(a.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        description="Publish timed messages to screens, mobiles and the in-app inbox (H50)."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            New announcement
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={items}
        getRowId={(a) => String(a.id)}
        loading={loading}
        searchable={(a) => `${a.title} ${a.body}`}
        searchPlaceholder="Search announcements..."
        pageSize={15}
        rowActions={(a) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Edit announcement"
              onClick={() => setEditing(a)}
            >
              <PencilIcon className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete announcement"
              className="text-destructive"
              onClick={() => setDeleting(a)}
            >
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        )}
        empty={{
          icon: MegaphoneIcon,
          title: "No announcements yet",
          description: "Publish the first one — it fans out to screens, push and the inbox.",
        }}
      />

      <AnnouncementFormModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New announcement"
        initial={EMPTY_FORM}
        onSubmit={async (values) => {
          await notificationsApi.createAnnouncement(values);
          toast.success("Announcement created.");
          setCreateOpen(false);
          await load();
        }}
      />

      {editing && (
        <AnnouncementFormModal
          open={Boolean(editing)}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          title="Edit announcement"
          initial={toForm(editing)}
          onSubmit={async (values) => {
            await notificationsApi.updateAnnouncement(editing.id, values);
            toast.success("Announcement updated.");
            setEditing(null);
            await load();
          }}
        />
      )}

      {deleting && (
        <Modal
          open={Boolean(deleting)}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          title="Delete this announcement?"
          description={`"${deleting.title}" will stop appearing everywhere it was fanned out to.`}
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <SubmitButton variant="destructive" pending={busy} onClick={() => remove(deleting)}>
                Delete
              </SubmitButton>
            </>
          }
        >
          <p className="text-muted-foreground text-sm">This can&apos;t be undone.</p>
        </Modal>
      )}
    </div>
  );
}

function AnnouncementFormModal({
  open,
  onOpenChange,
  title,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial: AnnouncementInput;
  onSubmit: (values: AnnouncementInput) => Promise<void>;
}) {
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setValues(initial);
  }, [initial]);

  const invalidWindow =
    Boolean(values.publishAt) &&
    Boolean(values.expiresAt) &&
    new Date(values.expiresAt as string).getTime() <=
      new Date(values.publishAt as string).getTime();

  async function submit() {
    setPending(true);
    try {
      await onSubmit(values);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save announcement.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} icon={MegaphoneIcon} size="lg">
      <div className="space-y-4">
        <Field label="Title">
          <Input
            value={values.title}
            onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
            placeholder="Dinner is ready"
          />
        </Field>
        <Field label="Message">
          <Textarea
            rows={4}
            value={values.body}
            onChange={(e) => setValues((v) => ({ ...v, body: e.target.value }))}
            placeholder="Head to the main hall — dinner is served until 9pm."
          />
        </Field>
        <Field label="Audience">
          <Select
            value={values.targetRole ?? EVERYONE}
            onValueChange={(value) =>
              setValues((v) => ({ ...v, targetRole: value === EVERYONE ? null : value }))
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EVERYONE}>Everyone</SelectItem>
              <SelectItem value="participant">
                Participants (confirmed spot or a project)
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Visible from">
            <ScheduledDateTimeField
              value={values.publishAt ?? ""}
              onChange={(publishAt) => setValues((v) => ({ ...v, publishAt: publishAt || null }))}
              emptyLabel="Immediately"
              addLabel="Schedule start"
            />
          </Field>
          <Field label="Visible until">
            <ScheduledDateTimeField
              value={values.expiresAt ?? ""}
              onChange={(expiresAt) => setValues((v) => ({ ...v, expiresAt: expiresAt || null }))}
              emptyLabel="No end date"
              addLabel="Schedule end"
            />
          </Field>
        </div>
        {invalidWindow && (
          <p className="text-destructive text-sm">The end time must be after the start time.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton
            pending={pending}
            onClick={submit}
            disabled={!values.title.trim() || !values.body.trim() || invalidWindow}
          >
            Save
          </SubmitButton>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
