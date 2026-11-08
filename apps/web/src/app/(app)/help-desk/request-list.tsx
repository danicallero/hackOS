"use client";
import type { MeetingMode } from "@hackos/shared/help-desk";
import Link from "next/link";
import { useId, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { type Column, DataTable } from "@/components/common/data-table";
import { Modal } from "@/components/common/modal";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { formatEventDate } from "@/lib/datetime";
import { type Translate, useLocale } from "@/lib/i18n";
import type { Tone } from "@/lib/tones";
import { type HelpRequest, REQUEST_STATUS } from "./model";
import { RequestForm } from "./requests/request-form";

const STATUS_TONE: Record<HelpRequest["status"], Tone> = {
  open: "warning",
  claimed: "info",
  resolved: "success",
  cancelled: "neutral",
};

/** Who the request is for: the team's project, else the requester. */
function requestFor(request: HelpRequest, t: Translate) {
  return request.project?.name ?? request.requester?.displayName ?? t("helpDeskRemovedAccount");
}

function topicNames(request: HelpRequest, t: Translate) {
  return [
    ...request.topics.map((topic) => topic.name),
    ...(request.other ? [t("helpDeskOther")] : []),
  ].join(" · ");
}

/** Challenge, topics and sponsor preference as one quiet line under the need. */
function contextLine(request: HelpRequest, t: Translate, position?: number) {
  return [
    request.challenge?.name,
    topicNames(request, t),
    request.preferSponsor ? t("helpDeskSponsorPreferred") : null,
    position ? t("helpDeskQueuePosition", { position }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** H66: the meeting arrangement the requesting side must act on. */
function meetingText(request: HelpRequest, t: Translate) {
  if (!request.claim) return null;
  return t(request.claim.mode === "on_my_way" ? "helpDeskComing" : "helpDeskGoTo", {
    name: request.claim.helper?.displayName ?? t("helpDeskRemovedAccount"),
    location:
      request.claim.mode === "on_my_way" ? request.location : (request.claim.meetingLocation ?? ""),
  });
}

/** Detail variant of the meeting line: the helper's name opens their profile. */
function MeetingLine({ request, t }: { request: HelpRequest; t: Translate }) {
  const text = meetingText(request, t);
  const helper = request.claim?.helper;
  const name = helper?.displayName;
  const at = text && name ? text.indexOf(name) : -1;
  if (!text || !helper || !name || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Link href={`/help-desk/helpers/${helper.userId}`} className="underline underline-offset-4">
        {name}
      </Link>
      {text.slice(at + name.length)}
    </>
  );
}

/** H64: a helper opens the requester's public profile when they share one. */
function RequesterLink({ request }: { request: HelpRequest }) {
  return (
    <Link
      href={`/help-desk/requests/${request.id}/requester`}
      className="underline underline-offset-4"
    >
      {request.requesterProfile?.displayName ?? request.requester?.displayName}
    </Link>
  );
}

export function RequestStatus({ request }: { request: HelpRequest }) {
  const { t } = useLocale();
  return (
    <StatusBadge tone={STATUS_TONE[request.status]}>
      {t(REQUEST_STATUS[request.status])}
    </StatusBadge>
  );
}

/**
 * H64-H66 dense request list, following the Users table: the need and its
 * topics lead each row, then who and where, status and time. Rows open the
 * request; in the helper inbox an open request can be claimed in place.
 */
export function RequestTable({
  requests,
  reload,
  onClaimed,
  audience,
}: {
  requests: HelpRequest[];
  reload: () => void;
  onClaimed?: () => void;
  /** `helper`: the inbox; `requester`: my and my team's requests. */
  audience: "helper" | "requester";
}) {
  const { t, language } = useLocale();
  // H65: the inbox lists open requests in queue order, oldest first.
  const positions = new Map<number, number>();
  if (audience === "helper") {
    let place = 0;
    for (const item of requests)
      if (item.status === "open") positions.set(item.id, item.queuePosition ?? ++place);
  }
  const columns: Column<HelpRequest>[] = [
    {
      id: "request",
      header: t("helpDeskRequestColumn"),
      cell: (request) => (
        <div className="min-w-0 max-w-md space-y-0.5 whitespace-normal">
          <p className="line-clamp-2 font-medium wrap-anywhere">{request.description}</p>
          <p className="text-muted-foreground text-xs">
            {contextLine(request, t, positions.get(request.id))}
          </p>
        </div>
      ),
    },
    {
      id: "for",
      header: t("helpDeskFor"),
      cell: (request) =>
        audience === "requester" && !request.project ? t("helpDeskMyself") : requestFor(request, t),
      sortValue: (request) => requestFor(request, t),
    },
    {
      id: "where",
      header: t("helpDeskWhere"),
      cell: (request) => <span className="wrap-anywhere">{request.location}</span>,
    },
    {
      id: "status",
      header: t("helpDeskStatusColumn"),
      cell: (request) => (
        <div className="space-y-0.5 whitespace-normal">
          <RequestStatus request={request} />
          {audience === "requester" && request.status === "claimed" ? (
            <p className="text-xs">{meetingText(request, t)}</p>
          ) : null}
          {audience === "helper" && request.viewer.notified && request.status === "open" ? (
            <p className="text-muted-foreground text-xs">{t("helpDeskRoutedToYou")}</p>
          ) : null}
        </div>
      ),
      sortValue: (request) => request.status,
    },
    {
      id: "created",
      header: t("created"),
      align: "right",
      cell: (request) => (
        <time dateTime={request.createdAt} className="tabular-nums">
          {formatEventDate(request.createdAt, language, "dayMonthTime")}
        </time>
      ),
      sortValue: (request) => request.createdAt,
    },
  ];
  return (
    <DataTable
      data={requests}
      columns={columns}
      getRowId={(request) => String(request.id)}
      getRowHref={(request) => `/help-desk/requests/${request.id}`}
      getRowLabel={(request) => `${t("helpDeskViewRequest")}: ${request.description}`}
      rowActions={
        audience === "helper"
          ? (request) =>
              request.viewer.canClaim ? (
                <ClaimAction request={request} reload={reload} onClaimed={onClaimed} size="sm" />
              ) : null
          : undefined
      }
      empty={{ title: t("helpDeskNoRequests") }}
      renderMobileRow={(request) => (
        <div className="space-y-2 px-4 py-3">
          <Link
            href={`/help-desk/requests/${request.id}`}
            className="focus-visible:ring-ring block space-y-1 rounded-sm outline-none focus-visible:ring-2"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="line-clamp-2 min-w-0 font-medium wrap-anywhere">
                {request.description}
              </span>
              <RequestStatus request={request} />
            </div>
            <p className="text-muted-foreground text-xs">
              {contextLine(request, t, positions.get(request.id))}
            </p>
            <p className="text-muted-foreground text-xs wrap-anywhere">
              {[
                audience === "requester" && !request.project
                  ? t("helpDeskMyself")
                  : requestFor(request, t),
                request.location,
                formatEventDate(request.createdAt, language, "dayMonthTime"),
              ].join(" · ")}
            </p>
            {audience === "requester" && request.status === "claimed" ? (
              <p className="text-sm">{meetingText(request, t)}</p>
            ) : null}
          </Link>
          {audience === "helper" && request.viewer.canClaim ? (
            <ClaimAction request={request} reload={reload} onClaimed={onClaimed} size="sm" />
          ) : null}
        </div>
      )}
    />
  );
}

/** One request with everything the caller may do with it (detail page). */
export function RequestDetail({
  request,
  reload,
  onClaimed,
}: {
  request: HelpRequest;
  reload: () => void;
  onClaimed?: () => void;
}) {
  const { t, language } = useLocale();
  const [pending, setPending] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "release" | "resolve" | "cancel") {
    setPending(true);
    setError(null);
    try {
      await api.post(`/api/helpdesk/requests/${request.id}/${action}`);
      setConfirmCancel(false);
    } catch (err) {
      setError(apiErrorText(err, t, t("helpDeskActionError")));
    } finally {
      setPending(false);
      reload();
    }
  }
  const meeting = meetingText(request, t);
  const rows = [
    {
      id: "for",
      label: t("helpDeskFor"),
      value: !request.requesterProfile ? (
        requestFor(request, t)
      ) : request.project ? (
        <>
          {request.project.name} · <RequesterLink request={request} />
        </>
      ) : (
        <RequesterLink request={request} />
      ),
    },
    { id: "where", label: t("helpDeskWhere"), value: request.location },
    {
      id: "topics",
      label: t("helpDeskTopics"),
      value: topicNames(request, t),
    },
    ...(request.challenge
      ? [{ id: "challenge", label: t("helpDeskChallenge"), value: request.challenge.name }]
      : []),
    {
      id: "created",
      label: t("created"),
      value: formatEventDate(request.createdAt, language, "dateTime"),
    },
  ];
  return (
    <article className="space-y-6">
      <div className="space-y-3">
        <RequestStatus request={request} />
        <p className="whitespace-pre-line wrap-anywhere text-pretty">{request.description}</p>
        {meeting ? (
          <p className="font-medium text-pretty" role="status">
            <MeetingLine request={request} t={t} />
          </p>
        ) : null}
        {request.status === "open" && request.queuePosition ? (
          <p className="text-muted-foreground text-sm">
            {t("helpDeskQueuePosition", { position: request.queuePosition })}
          </p>
        ) : null}
        {request.preferSponsor ? (
          <p className="text-muted-foreground text-sm">{t("helpDeskSponsorPreferred")}</p>
        ) : null}
        {request.status === "open" &&
        (request.routing === "none" || request.routing === "fallback") ? (
          <p className="text-muted-foreground text-sm">
            {t(request.routing === "none" ? "helpDeskNoAudience" : "helpDeskFallback")}
          </p>
        ) : null}
      </div>
      <dl className="divide-y divide-border/60 border-y border-border/60">
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid min-w-0 gap-1 py-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4"
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 wrap-anywhere">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap justify-end gap-2">
        {request.viewer.canEdit ? (
          <Button variant="outline" disabled={pending} onClick={() => setEditing(true)}>
            {t("helpDeskEdit")}
          </Button>
        ) : null}
        {request.viewer.canRelease ? (
          <Button variant="outline" disabled={pending} onClick={() => void act("release")}>
            {t("helpDeskRelease")}
          </Button>
        ) : null}
        {request.viewer.canCancel ? (
          <Button variant="outline" disabled={pending} onClick={() => setConfirmCancel(true)}>
            {t("helpDeskCancel")}
          </Button>
        ) : null}
        {request.viewer.canResolve ? (
          <Button disabled={pending} loading={pending} onClick={() => void act("resolve")}>
            {t("helpDeskResolve")}
          </Button>
        ) : null}
        {request.viewer.canClaim ? (
          <ClaimAction request={request} reload={reload} onClaimed={onClaimed} />
        ) : null}
      </div>
      {error ? <ContextualError message={error} /> : null}
      <Modal open={editing} onOpenChange={setEditing} title={t("helpDeskEdit")}>
        <RequestForm
          request={request}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      </Modal>
      <AlertModal
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t("helpDeskCancel")}
        description={t("helpDeskCancelConsequence")}
        cancelLabel={t("keepEditing")}
        confirmLabel={t("helpDeskCancel")}
        pending={pending}
        onConfirm={() => void act("cancel")}
      />
    </article>
  );
}

/**
 * H66: Claim opens a short dialog: on my way to the stated location, or come
 * to a location I give. A lost concurrent claim stays visible and refreshes.
 */
export function ClaimAction({
  request,
  reload,
  onClaimed,
  size,
}: {
  request: HelpRequest;
  reload: () => void;
  onClaimed?: () => void;
  size?: "sm";
}) {
  const { t } = useLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<MeetingMode>("on_my_way");
  const [location, setLocation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function claim() {
    setPending(true);
    setError(null);
    try {
      await api.post(`/api/helpdesk/requests/${request.id}/claim`, {
        mode,
        ...(mode === "meet_at" ? { meetingLocation: location.trim() } : {}),
      });
      setOpen(false);
      onClaimed?.();
    } catch (err) {
      setError(
        err instanceof ApiError &&
          (err.code === "help_request_already_claimed" ||
            (err.details as { code?: string })?.code === "help_request_already_claimed")
          ? t("helpDeskClaimConflict")
          : apiErrorText(err, t, t("helpDeskActionError")),
      );
    } finally {
      setPending(false);
      reload();
    }
  }
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        {t("helpDeskClaim")}
      </Button>
      <Modal open={open} onOpenChange={setOpen} size="sm" title={t("helpDeskClaim")}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void claim();
          }}
        >
          <p className="text-sm wrap-anywhere">
            {request.description}
            <span className="text-muted-foreground block">{request.location}</span>
          </p>
          <fieldset disabled={pending} className="space-y-2">
            <legend className="sr-only">{t("helpDeskClaim")}</legend>
            {(["on_my_way", "meet_at"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${id}-mode`}
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="accent-primary size-4"
                />
                {t(value === "on_my_way" ? "helpDeskOnWay" : "helpDeskMeetAt")}
              </label>
            ))}
            {mode === "meet_at" ? (
              <div className="space-y-2 pt-2">
                <Label htmlFor={`${id}-destination`}>{t("helpDeskDestination")}</Label>
                <Input
                  id={`${id}-destination`}
                  required
                  maxLength={120}
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                />
              </div>
            ) : null}
          </fieldset>
          {error ? <ContextualError message={error} /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("helpDeskClaim")}
            </Button>
          </div>
        </form>
      </Modal>
      {error && !open ? <ContextualError message={error} /> : null}
    </>
  );
}
