"use client";

// H50 announcement administration: create/edit/delete, audience, publish/expiry
// window and current/scheduled/expired status. Gated by announcements:manage;
// consumes the CRUD API in apps/api/src/modules/notifications/routes/announcements.ts.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  CheckCircle2Icon,
  ClockIcon,
  InboxIcon,
  MegaphoneIcon,
  PencilIcon,
  PlusIcon,
  SmartphoneIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { ContextualError } from "@/components/common/contextual-error";
import { type Column, DataTable } from "@/components/common/data-table";
import { DateTimeInput } from "@/components/common/datetime-input";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
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
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { formatScheduledDateTime, fromDatetimeLocal, getTimeZoneLabel } from "@/lib/datetime";
import { type Translate, useLocale } from "@/lib/i18n";
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

function statusLabel(status: AnnouncementStatus, t: Translate): string {
  const map: Record<AnnouncementStatus, string> = {
    scheduled: t("dataStatusScheduled"),
    live: t("statusLive"),
    expired: t("statusExpired"),
  };
  return map[status];
}

function audienceLabel(targetRole: string | null, t: Translate): string {
  return targetRole === "participant" ? t("participantsAudience") : t("everyoneAudience");
}

/** Every announcement fans out over the same two channels today (H50). */
function AnnouncementChannels() {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1">
        <InboxIcon className="size-3.5" aria-hidden="true" />
        {"·"}
      </span>
      <span className="inline-flex items-center gap-1">
        <SmartphoneIcon className="size-3.5" aria-hidden="true" />
      </span>
    </span>
  );
}

type DeliveryState = "delivered" | "sending" | "notSent";

function deliveryState(a: Announcement): DeliveryState {
  if (a.fanned_out_at) return "delivered";
  return announcementStatus(a) === "scheduled" ? "notSent" : "sending";
}

function deliveryLabel(state: DeliveryState, t: Translate): string {
  const map: Record<DeliveryState, string> = {
    delivered: t("deliveryDelivered"),
    sending: t("deliverySending"),
    notSent: t("deliveryNotSent"),
  };
  return map[state];
}

export default function AnnouncementsPage() {
  const { t } = useLocale();
  const canManage = useCan(CAPABILITIES.ANNOUNCEMENTS_MANAGE);
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await notificationsApi.listAnnouncements();
      setItems(result.items);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotLoadAnnouncements");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // publishes/edits/deletes an announcement elsewhere (H50).
  const liveRefresh = useAutoRefresh("/api/content/stream", [EVENTS.CONTENT_ANNOUNCEMENT]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (canManage) void load();
    else setLoading(false);
  }, [canManage, load, liveRefresh]);

  async function remove(item: Announcement) {
    setBusy(true);
    setDeleteError(null);
    try {
      await notificationsApi.deleteAnnouncement(item.id);
      toast.success(t("announcementDeleted"));
      setDeleting(null);
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotDeleteAnnouncement");
      setDeleteError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return <AccessDenied ask={t("announcementsDeniedDesc")} />;
  }

  const columns: Column<Announcement>[] = [
    {
      id: "title",
      header: t("colAnnouncement"),
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
      header: t("colAudience"),
      sortValue: (a) => audienceLabel(a.target_role, t),
      cell: (a) => <StatusBadge tone="neutral">{audienceLabel(a.target_role, t)}</StatusBadge>,
    },
    {
      id: "status",
      header: t("statusColumn"),
      sortValue: (a) => announcementStatus(a),
      cell: (a) => {
        const status = announcementStatus(a);
        return <StatusBadge tone={STATUS_TONE[status]}>{statusLabel(status, t)}</StatusBadge>;
      },
    },
    {
      id: "window",
      header: t("colWindow"),
      sortValue: (a) => a.publish_at ?? "",
      cell: (a) => (
        <span className="text-muted-foreground text-xs">
          {a.publish_at ? formatScheduledDateTime(a.publish_at) : t("immediate")}
          {" → "}
          {a.expires_at ? formatScheduledDateTime(a.expires_at) : t("noEnd")}
        </span>
      ),
    },
    {
      id: "channels",
      header: t("colChannels"),
      cell: () => <AnnouncementChannels />,
    },
    {
      id: "delivery",
      header: t("colDelivery"),
      sortValue: (a) => deliveryState(a),
      cell: (a) => {
        const state = deliveryState(a);
        return (
          <span className="inline-flex items-center gap-1.5 text-xs">
            {state === "delivered" ? (
              <CheckCircle2Icon className="text-success size-3.5" aria-hidden="true" />
            ) : (
              <ClockIcon className="text-muted-foreground size-3.5" aria-hidden="true" />
            )}
            {deliveryLabel(state, t)}
          </span>
        );
      },
    },
    {
      id: "created",
      header: t("colCreated"),
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
        title={t("announcements")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            {t("newAnnouncement")}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={items}
        getRowId={(a) => String(a.id)}
        loading={loading}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        searchable={(a) => `${a.title} ${a.body}`}
        searchPlaceholder={t("searchAnnouncementsPlaceholder")}
        pageSize={15}
        rowActions={(a) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("editAnnouncementAria")}
              onClick={() => setEditing(a)}
            >
              <PencilIcon className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("deleteAnnouncementAria")}
              className="text-destructive"
              onClick={() => {
                setDeleteError(null);
                setDeleting(a);
              }}
            >
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        )}
        empty={{
          icon: MegaphoneIcon,
          title: t("noAnnouncementsYet"),
          description: t("publishFirstOne"),
        }}
      />

      <AnnouncementFormModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("newAnnouncement")}
        initial={EMPTY_FORM}
        onSubmit={async (values) => {
          await notificationsApi.createAnnouncement(values);
          toast.success(t("announcementCreated"));
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
          title={t("editAnnouncementAria")}
          initial={toForm(editing)}
          onSubmit={async (values) => {
            await notificationsApi.updateAnnouncement(editing.id, values);
            toast.success(t("announcementUpdated"));
            setEditing(null);
            await load();
          }}
        />
      )}

      {deleting && (
        <Modal
          open={Boolean(deleting)}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteError(null);
              setDeleting(null);
            }
          }}
          title={t("deleteThisAnnouncement")}
          description={t("willStopAppearing", { title: deleting.title })}
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                {t("cancel")}
              </Button>
              <SubmitButton variant="destructive" pending={busy} onClick={() => remove(deleting)}>
                {t("deleteAction")}
              </SubmitButton>
            </>
          }
        >
          <div className="space-y-4">
            {deleteError && <ContextualError message={deleteError} />}
            <p className="text-muted-foreground text-sm">{t("cantBeUndone")}</p>
          </div>
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
  const { t } = useLocale();
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
    // `datetime-local` deliberately has no timezone.  Convert it here so the
    // API always receives the offset-bearing ISO timestamp it validates.
    const publishAt = values.publishAt ? fromDatetimeLocal(values.publishAt) : null;
    const expiresAt = values.expiresAt ? fromDatetimeLocal(values.expiresAt) : null;
    if ((values.publishAt && !publishAt) || (values.expiresAt && !expiresAt)) {
      toast.error(t("enterValidDatesTimes"));
      return;
    }
    setPending(true);
    try {
      await onSubmit({ ...values, publishAt, expiresAt });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveAnnouncement"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} icon={MegaphoneIcon} size="lg">
      <div className="space-y-4">
        <Field label={t("titleLabel")}>
          <Input
            value={values.title}
            onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
            placeholder={t("dinnerReadyPlaceholder")}
          />
        </Field>
        <Field label={t("messageLabel")}>
          <Textarea
            rows={4}
            value={values.body}
            onChange={(e) => setValues((v) => ({ ...v, body: e.target.value }))}
            placeholder={t("headToMainHallPlaceholder")}
          />
        </Field>
        <Field label={t("colAudience")}>
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
              <SelectItem value={EVERYONE}>{t("everyoneAudience")}</SelectItem>
              <SelectItem value="participant">{t("participantsConfirmedOption")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("visibleFrom")}>
            <DateTimeInput
              value={values.publishAt ?? ""}
              onChange={(publishAt) => setValues((v) => ({ ...v, publishAt: publishAt || null }))}
              nullOption={{ label: t("immediatelyLabel") }}
            />
            <p className="text-muted-foreground text-sm text-pretty">
              {t("publishDestinationsHint", { timezone: getTimeZoneLabel() })}
            </p>
          </Field>
          <Field label={t("visibleUntil")}>
            <DateTimeInput
              value={values.expiresAt ?? ""}
              onChange={(expiresAt) => setValues((v) => ({ ...v, expiresAt: expiresAt || null }))}
              nullOption={{ label: t("noEndDate") }}
            />
          </Field>
        </div>
        {invalidWindow && <p className="text-destructive text-sm">{t("endTimeAfterStart")}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <SubmitButton
            pending={pending}
            onClick={submit}
            disabled={!values.title.trim() || !values.body.trim() || invalidWindow}
          >
            {t("save")}
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
