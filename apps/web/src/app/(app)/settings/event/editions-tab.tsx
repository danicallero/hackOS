"use client";

import {
  EDITION_KEY_PATTERN,
  type EditionStatus,
  type EditionSummary,
} from "@hackos/shared/editions";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useId, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { Modal } from "@/components/common/modal";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { formatEventDate, fromDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { invalidateAllServerState } from "@/lib/server-state";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Tone } from "@/lib/tones";

const STATUS_TONE: Record<EditionStatus, Tone> = {
  draft: "neutral",
  active: "success",
  closed: "warning",
};

/** Editions of the installation: create, make current, close and reopen (event:manage). */
export function EditionsTab() {
  const { t, language } = useLocale();
  const { refresh } = useSessionContext();
  const { data, error, reload } = useServerResource<{ items: EditionSummary[] }>(
    ["editions", "admin"],
    (signal) => api.get<{ items: EditionSummary[] }>("/api/editions", { signal }),
  );
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<EditionSummary | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const statusLabel: Record<EditionStatus, string> = {
    draft: t("editionStatusDraft"),
    active: t("editionStatusActive"),
    closed: t("editionStatusClosed"),
  };

  /** Lifecycle changes alter what every screen shows: drop cached reads and refetch session facts. */
  async function afterChange() {
    invalidateAllServerState();
    reload();
    await refresh();
  }

  async function transition(
    edition: EditionSummary,
    action: "activate" | "close" | "reopen",
    success: string,
  ) {
    setPendingKey(edition.eventKey);
    try {
      await api.post(`/api/editions/${encodeURIComponent(edition.eventKey)}/${action}`);
      toast.success(success);
      setClosing(null);
      await afterChange();
    } catch (err) {
      toast.error(apiErrorText(err, t, t("couldNotUpdateEdition")), t("editions"));
    } finally {
      setPendingKey(null);
    }
  }

  if (error && !data) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {apiErrorText(error, t, t("couldNotUpdateEdition"))}
      </p>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden="true" />
          {t("editionCreate")}
        </Button>
      </div>
      <ul className="divide-y">
        {items.map((edition) => {
          const dates = [edition.startsAt, edition.endsAt]
            .filter((value): value is string => !!value)
            .map((value) => formatEventDate(value, language, "date"))
            .join(" – ");
          const pending = pendingKey === edition.eventKey;
          return (
            <li key={edition.eventKey} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{edition.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {[edition.eventKey, dates].filter(Boolean).join(" · ")}
                </p>
              </div>
              <StatusBadge tone={STATUS_TONE[edition.status]}>
                {statusLabel[edition.status]}
              </StatusBadge>
              {edition.status === "draft" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={pending}
                  onClick={() => void transition(edition, "activate", t("editionMadeCurrent"))}
                >
                  {t("editionMakeCurrent")}
                </Button>
              )}
              {edition.status === "active" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setClosing(edition)}
                >
                  {t("editionClose")}
                </Button>
              )}
              {edition.status === "closed" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={pending}
                  onClick={() => void transition(edition, "reopen", t("editionReopenedDone"))}
                >
                  {t("editionReopen")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <CreateEditionModal
        open={creating}
        onOpenChange={setCreating}
        onCreated={async () => {
          setCreating(false);
          toast.success(t("editionCreated"));
          await afterChange();
        }}
      />

      <AlertModal
        open={closing !== null}
        onOpenChange={(open) => !open && setClosing(null)}
        title={t("editionCloseTitle", { name: closing?.name ?? "" })}
        description={t("editionCloseConsequences")}
        cancelLabel={t("cancel")}
        confirmLabel={t("editionClose")}
        pending={closing !== null && pendingKey === closing.eventKey}
        destructive
        onConfirm={() => closing && void transition(closing, "close", t("editionClosedDone"))}
      />
    </div>
  );
}

function CreateEditionModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const { t } = useLocale();
  const formId = useId();
  const [eventKey, setEventKey] = useState("");
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [pending, setPending] = useState(false);
  const [invalid, setInvalid] = useState(false);

  function change(next: boolean) {
    if (pending) return;
    if (!next) {
      setEventKey("");
      setName("");
      setStartsAt("");
      setEndsAt("");
      setInvalid(false);
    }
    onOpenChange(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!EDITION_KEY_PATTERN.test(eventKey) || !name.trim()) {
      setInvalid(true);
      return;
    }
    setPending(true);
    try {
      await api.post("/api/editions", {
        eventKey,
        name: name.trim(),
        ...(startsAt ? { startsAt: fromDatetimeLocal(`${startsAt}T00:00`) } : {}),
        ...(endsAt ? { endsAt: fromDatetimeLocal(`${endsAt}T23:59`) } : {}),
      });
      setPending(false);
      change(false);
      await onCreated();
    } catch (err) {
      setPending(false);
      toast.error(apiErrorText(err, t, t("couldNotUpdateEdition")), t("editions"));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={change}
      title={t("editionCreate")}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={() => change(false)}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {t("editionCreate")}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4 py-1" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-name`}>{t("editionName")}</Label>
          <Input
            id={`${formId}-name`}
            value={name}
            aria-invalid={invalid && !name.trim()}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-key`}>{t("editionKey")}</Label>
          <Input
            id={`${formId}-key`}
            value={eventKey}
            aria-invalid={invalid && !EDITION_KEY_PATTERN.test(eventKey)}
            onChange={(event) => setEventKey(event.target.value.toLowerCase())}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-starts`}>{t("editionStartsAt")}</Label>
            <Input
              id={`${formId}-starts`}
              type="date"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-ends`}>{t("editionEndsAt")}</Label>
            <Input
              id={`${formId}-ends`}
              type="date"
              value={endsAt}
              min={startsAt || undefined}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
