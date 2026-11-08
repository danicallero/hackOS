"use client";
import Link from "next/link";
import { useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
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
import { ApiError, api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { formatEventDate } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { type HelpRequest, REQUEST_STATUS } from "./model";
export function RequestList({
  requests,
  reload,
  onClaimed,
}: {
  requests: HelpRequest[];
  reload: () => void;
  onClaimed?: () => void;
}) {
  const { t } = useLocale();
  return requests.length ? (
    <div className="divide-y">
      {requests.map((request) => (
        <RequestRow key={request.id} request={request} reload={reload} onClaimed={onClaimed} />
      ))}
    </div>
  ) : (
    <EmptyState title={t("helpDeskNoRequests")} />
  );
}
export function RequestRow({
  request,
  reload,
  onClaimed,
}: {
  request: HelpRequest;
  reload: () => void;
  onClaimed?: () => void;
}) {
  const { t, language } = useLocale();
  const [mode, setMode] = useState<"on_my_way" | "meet_at">("on_my_way");
  const [location, setLocation] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: string) {
    setPending(true);
    setError(null);
    try {
      await api.post(
        `/api/helpdesk/requests/${request.id}/${action}`,
        action === "claim"
          ? { mode, ...(mode === "meet_at" ? { meetingLocation: location.trim() } : {}) }
          : undefined,
      );
      if (action === "claim") onClaimed?.();
      setConfirmCancel(false);
      reload();
    } catch (err) {
      setError(
        err instanceof ApiError &&
          (err.code === "help_request_already_claimed" ||
            (err.details as { code?: string })?.code === "help_request_already_claimed")
          ? t("helpDeskClaimConflict")
          : apiErrorText(err, t, t("helpDeskActionError")),
      );
      reload();
    } finally {
      setPending(false);
    }
  }
  return (
    <article className="space-y-4 py-5 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/help-desk/requests/${request.id}`}
            className="inline-flex min-h-6 items-center font-medium underline-offset-4 hover:underline"
          >
            {request.project?.name ?? request.requester?.displayName ?? t("helpDeskRemovedAccount")}
          </Link>
          <p className="text-muted-foreground text-xs">
            {formatEventDate(request.createdAt, language, "dateTime")}
          </p>
        </div>
        <StatusBadge
          tone={
            request.status === "open"
              ? "warning"
              : request.status === "claimed"
                ? "info"
                : request.status === "resolved"
                  ? "success"
                  : "neutral"
          }
        >
          {t(REQUEST_STATUS[request.status])}
        </StatusBadge>
      </div>
      <p className="text-sm whitespace-pre-line wrap-anywhere">{request.description}</p>
      <p className="text-sm">
        {[
          ...request.topics.map((topic) => topic.name),
          ...(request.other ? [t("helpDeskOther")] : []),
        ].join(" · ")}
      </p>
      <p className="text-muted-foreground text-sm wrap-anywhere">{request.location}</p>
      {request.status === "open" && request.routing !== "matched" ? (
        <p className="text-muted-foreground text-sm">
          {t(request.routing === "none" ? "helpDeskNoAudience" : "helpDeskFallback")}
        </p>
      ) : null}
      {request.claim ? (
        <p className="text-sm font-medium text-pretty" role="status">
          {t(request.claim.mode === "on_my_way" ? "helpDeskComing" : "helpDeskGoTo", {
            name: request.claim.helper?.displayName ?? t("helpDeskRemovedAccount"),
            location:
              request.claim.mode === "on_my_way"
                ? request.location
                : (request.claim.meetingLocation ?? ""),
          })}
        </p>
      ) : null}
      {request.viewer.canClaim ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void act("claim");
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`meeting-${request.id}`}>{t("helpDeskClaim")}</Label>
            <Select
              value={mode}
              onValueChange={(value) => setMode(value as typeof mode)}
              disabled={pending}
            >
              <SelectTrigger id={`meeting-${request.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="on_my_way">{t("helpDeskOnWay")}</SelectItem>
                <SelectItem value="meet_at">{t("helpDeskMeetAt")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "meet_at" ? (
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor={`destination-${request.id}`}>{t("helpDeskDestination")}</Label>
              <Input
                id={`destination-${request.id}`}
                required
                maxLength={120}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                disabled={pending}
              />
            </div>
          ) : null}
          <Button type="submit" loading={pending}>
            {t("helpDeskClaim")}
          </Button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
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
      </div>
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
      {error ? <ContextualError message={error} /> : null}
    </article>
  );
}
