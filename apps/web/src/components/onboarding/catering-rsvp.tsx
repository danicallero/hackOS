"use client";

import { useEffect, useMemo, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { FormActions } from "@/components/common/form-actions";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { rsvpSaveErrorKey, useRsvps } from "@/hooks/use-rsvps";
import { useLocale } from "@/lib/i18n";
import {
  draftBlocked,
  draftFromItems,
  isItemChanged,
  needsAnswer,
  type RsvpAnswer,
  type RsvpDraft,
  type RsvpItem,
  rsvpWhen,
} from "@/lib/rsvp";
import { useMe } from "@/lib/session";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Attendee RSVP editor: one row per open RSVP (yes / no / unsure, plus an
 * option when the organizer defined some). Used as an editable section of My
 * profile and as the onboarding RSVP step. Skipping an optional item is a valid
 * state; a required one blocks Save until answered. Locked items are read-only.
 *
 * Integration points for the host page:
 * - `<CateringRsvpSection userId onDirtyChange onSaved />` fetches and saves on its own;
 *   render nothing extra when the person has no open RSVPs (it returns null).
 * - `onSaved` runs after a successful save (refresh the session so
 *   `pendingProfileTasks` / the onboarding step re-evaluate).
 * - `<CateringRsvpForm items save .../>` is the controlled form for hosts that
 *   already hold the items (e.g. the onboarding flow).
 */
export function CateringRsvpSection({
  userId,
  onDirtyChange,
  onSaved,
  footer = true,
  actions,
}: {
  userId: number;
  actions?: React.ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void | Promise<void>;
  /** Hosts that supply their own Save/Skip controls pass false and use `formId`. */
  footer?: boolean;
}) {
  const { items, loadError, reload, save } = useRsvps(userId);
  const { t } = useLocale();

  if (loadError && !items) {
    return <ContextualError message={t("couldNotLoadRsvps")} onRetry={reload} />;
  }
  if (!items || items.length === 0) return null;
  // Remount on every stored list so the draft restarts from the stored answers.
  const version = items
    .map((i) => `${i.activityId}:${i.answer}:${i.optionKey}:${i.locked}:${i.options.length}`)
    .join(",");
  return (
    <CateringRsvpForm
      key={version}
      items={items}
      save={save}
      onDirtyChange={onDirtyChange}
      onSaved={onSaved}
      footer={footer}
      actions={actions}
    />
  );
}

/**
 * Self-contained variant for the onboarding step and My profile: reads the
 * signed-in user, fetches and saves `/api/me/rsvps`, renders its own Save with
 * the host's `actions` beside it, and renders nothing without open RSVPs.
 */
export function CateringRsvp({
  actions,
  onSaved,
  onDirtyChange,
}: {
  actions?: React.ReactNode;
  onSaved?: () => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const me = useMe();
  if (!me) return null;
  return (
    <CateringRsvpSection
      userId={me.id}
      actions={actions}
      onSaved={onSaved}
      onDirtyChange={onDirtyChange}
    />
  );
}

export default CateringRsvp;

export function CateringRsvpForm({
  items,
  save,
  onDirtyChange,
  onSaved,
  footer = true,
  formId,
  actions,
}: {
  items: readonly RsvpItem[];
  save: (items: readonly RsvpItem[], draft: RsvpDraft) => Promise<unknown>;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void | Promise<void>;
  footer?: boolean;
  formId?: string;
  /** Host buttons (Later / Skip / Continue) shown beside Save. */
  actions?: React.ReactNode;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState<RsvpDraft>(() => draftFromItems(items));
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const changed = useMemo(
    () => items.some((item) => isItemChanged(item, draft[item.activityId])),
    [items, draft],
  );
  const blocked = draftBlocked(items, draft);

  useEffect(() => {
    onDirtyChange?.(changed);
    return () => onDirtyChange?.(false);
  }, [changed, onDirtyChange]);

  function setAnswer(item: RsvpItem, answer: RsvpAnswer) {
    setDraft((current) => ({
      ...current,
      [item.activityId]: {
        answer,
        // A yes keeps a valid chosen option; anything else clears it.
        optionKey:
          answer === "yes" && item.options.length === 1
            ? item.options[0].key
            : answer === "yes"
              ? current[item.activityId].optionKey
              : null,
      },
    }));
  }

  function setOption(item: RsvpItem, optionKey: string) {
    setDraft((current) => ({ ...current, [item.activityId]: { answer: "yes", optionKey } }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (blocked || pending) return;
    setSaveError(null);
    setPending(true);
    try {
      await save(items, draft);
      await onSaved?.();
      toast.success(t("rsvpSaved"), { compactTitle: t("toastSaveRsvps") });
    } catch (err) {
      // A stale-list error has already refreshed the shared list, remounting this form.
      const message = t(rsvpSaveErrorKey(err));
      setSaveError(message);
      toast.error(message, t("toastSaveRsvps"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form id={formId} className="min-w-0" onSubmit={onSubmit} noValidate>
      <SectionCard
        footerClassName="justify-start"
        variant="plain"
        bodyClassName="pt-0"
        footer={
          footer ? (
            <FormActions
              pending={pending}
              disabled={blocked}
              state={saveError ? "error" : changed ? "unsaved" : "saved"}
              secondaryActions={actions}
            />
          ) : undefined
        }
      >
        {saveError && <ContextualError message={saveError} />}
        <ul className="divide-y divide-border/60">
          {items.map((item) => (
            <RsvpRow
              key={item.activityId}
              item={item}
              draft={draft[item.activityId]}
              disabled={pending}
              onAnswer={(answer) => setAnswer(item, answer)}
              onOption={(key) => setOption(item, key)}
            />
          ))}
        </ul>
      </SectionCard>
    </form>
  );
}

function RsvpRow({
  item,
  draft,
  disabled,
  onAnswer,
  onOption,
}: {
  item: RsvpItem;
  draft: RsvpDraft[number];
  disabled: boolean;
  onAnswer: (answer: RsvpAnswer) => void;
  onOption: (key: string) => void;
}) {
  const { t, language } = useLocale();
  const answers: RsvpAnswer[] = item.allowsUnsure ? ["yes", "no", "unsure"] : ["yes", "no"];
  const labels: Record<RsvpAnswer, string> = {
    yes: t("rsvpYes"),
    no: t("rsvpNo"),
    unsure: t("rsvpUnsure"),
  };
  const missing = needsAnswer(item, draft.answer);
  const retired = item.optionRetired && draft.optionKey === item.optionKey;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 font-medium text-sm wrap-anywhere">
          {item.name}
          {item.required && (
            <span className="text-muted-foreground font-normal"> · {t("rsvpRequired")}</span>
          )}
        </span>
        <span className="text-muted-foreground text-sm tabular-nums">
          {rsvpWhen(item, language)}
        </span>
      </div>
      {item.description && (
        <p className="text-muted-foreground text-sm wrap-anywhere">{item.description}</p>
      )}
      <div role="radiogroup" aria-label={item.name} className="flex flex-wrap gap-2">
        {answers.map((answer) => (
          <Choice
            key={answer}
            checked={draft.answer === answer}
            disabled={disabled || item.locked}
            invalid={missing}
            onSelect={() => onAnswer(answer)}
          >
            {labels[answer]}
          </Choice>
        ))}
      </div>
      {draft.answer === "yes" && item.options.length > 0 && (
        <div role="radiogroup" aria-label={t("rsvpOption")} className="flex flex-wrap gap-2">
          {item.options.map((option) => (
            <Choice
              key={option.key}
              checked={draft.optionKey === option.key}
              disabled={disabled || item.locked}
              invalid={!draft.optionKey || retired}
              onSelect={() => onOption(option.key)}
            >
              {option.label}
            </Choice>
          ))}
          {retired && item.optionLabel && (
            <span className="text-muted-foreground self-center text-sm">
              {item.optionLabel} · {t("rsvpOptionRetired")}
            </span>
          )}
        </div>
      )}
      {item.locked && <p className="text-muted-foreground text-xs">{t("rsvpClosed")}</p>}
    </li>
  );
}

function Choice({
  checked,
  disabled,
  invalid,
  onSelect,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  invalid: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      role="radio"
      aria-checked={checked}
      size="sm"
      variant={checked ? "default" : "outline"}
      disabled={disabled}
      className={cn(!checked && invalid && "border-destructive/60")}
      onClick={onSelect}
    >
      {children}
    </Button>
  );
}
