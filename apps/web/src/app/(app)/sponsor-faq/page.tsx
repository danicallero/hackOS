"use client";

// Sponsor info hub (H58, H59): a structured FAQ (question/answer pairs,
// collapsible, plus free-form text blocks) admins author for sponsor reps,
// and a "Sponsor events" panel: the sponsor-tagged slice of the schedule
// (deadlines, sponsor reception, etc.), shown with the same day-grouped
// timeline the public /horario page uses, extended to reveal each item's
// responsible person(s)/contact note. A sponsor rep's own /api/public/activities
// call already returns the entire public schedule too (H59 — sponsor is
// additive, never a narrower view of the general programme). Deliberately
// not public (unlike /horario) and not judge-visible (unlike challenges'
// challenge-directory access) — see requireSponsorPortalAccess.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { CalendarClockIcon, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { MultilingualInput } from "@/components/common/questionnaire-builder";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import type { PublicEvent } from "@/components/public/public-types";
import { ScheduleTimeline } from "@/components/public/schedule-timeline";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Surface } from "@/components/ui/surface";
import { ApiError, api } from "@/lib/api";
import { type I18nText, useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";
import { useCan, useMe } from "@/lib/session";
import { EMPTY_I18N, textForDisplay } from "../challenges/shared";

type FaqItemKind = "qa" | "text";
interface FaqItem {
  kind: FaqItemKind;
  heading: I18nText;
  body: I18nText;
}

interface SponsorFaqResponse {
  items: FaqItem[];
}

export default function SponsorFaqPage() {
  const { t } = useLocale();
  const me = useMe();
  const canManage = useCan(CAPABILITIES.SPONSORS_MANAGE);
  const canView = canManage || Boolean(me?.isSponsorRep);

  const [items, setItems] = useState<FaqItem[] | null>(null);
  const [draft, setDraft] = useState<FaqItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .get<SponsorFaqResponse>("/api/sponsor-faq")
      .then((r) => {
        setItems(r.items);
        setDraft(r.items);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t("couldNotLoadSponsorFaq"));
      });
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (canView) load();
  }, [canView, load]);

  if (!canView) return <AccessDenied ask={t("sponsorFaq")} />;
  if (error) return <ContextualError message={error} onRetry={load} />;
  if (items === null) return <Spinner className="size-5" />;

  async function save() {
    setSaving(true);
    try {
      const r = await api.put<SponsorFaqResponse>("/api/sponsor-faq", { items: draft });
      setItems(r.items);
      setDraft(r.items);
      toast.success(t("saved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveSponsorFaq"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("sponsorFaq")} />
      <Surface padding="default">
        {canManage ? (
          <FaqItemBuilder items={draft} onChange={setDraft} onSave={save} saving={saving} />
        ) : (
          <FaqItemsDisplay items={items} />
        )}
      </Surface>
      <SponsorScheduleCard />
    </div>
  );
}

function emptyItem(): FaqItem {
  return { kind: "qa", heading: { ...EMPTY_I18N }, body: { ...EMPTY_I18N } };
}

function FaqItemBuilder({
  items,
  onChange,
  onSave,
  saving,
}: {
  items: FaqItem[];
  onChange: (items: FaqItem[]) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const { t } = useLocale();

  function update(index: number, patch: Partial<FaqItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  return (
    <div className="space-y-6">
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id, edited/reordered in place.
        <div key={index} className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <Select
              value={item.kind}
              onValueChange={(kind) => update(index, { kind: kind as FaqItemKind })}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="qa">{t("faqKindQa")}</SelectItem>
                <SelectItem value="text">{t("faqKindText")}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("remove")}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              <XIcon className="size-4" />
            </Button>
          </div>
          <MultilingualInput
            label={item.kind === "qa" ? t("faqQuestionLabel") : t("faqBlockTitleLabel")}
            value={item.heading}
            onChange={(heading) => update(index, { heading })}
          />
          <MultilingualInput
            label={item.kind === "qa" ? t("faqAnswerLabel") : t("faqBlockBodyLabel")}
            textarea
            value={item.body}
            onChange={(body) => update(index, { body })}
          />
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={() => onChange([...items, emptyItem()])}>
          <PlusIcon className="size-4" />
          {t("addFaqItem")}
        </Button>
        <SubmitButton pending={saving} onClick={onSave}>
          {t("save")}
        </SubmitButton>
      </div>
    </div>
  );
}

function FaqItemsDisplay({ items }: { items: FaqItem[] }) {
  const { t } = useLocale();
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("noSponsorFaqYet")}</p>;
  }
  const qaItems = items.filter((item) => item.kind === "qa");
  const textItems = items.filter((item) => item.kind === "text");
  return (
    <div className="space-y-6">
      {textItems.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static admin-authored content, no stable id.
        <div key={index} className="space-y-1">
          <h3 className="text-sm font-medium">{textForDisplay(item.heading)}</h3>
          <p className="text-muted-foreground text-pretty whitespace-pre-wrap text-sm">
            {textForDisplay(item.body)}
          </p>
        </div>
      ))}
      {qaItems.length > 0 && (
        <Accordion type="multiple">
          {qaItems.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static admin-authored content, no stable id.
            <AccordionItem key={index} value={String(index)}>
              <AccordionTrigger>{textForDisplay(item.heading)}</AccordionTrigger>
              <AccordionContent className="text-pretty whitespace-pre-wrap">
                {textForDisplay(item.body)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}

/**
 * H59: the sponsor-tagged slice of the schedule (deadlines, sponsor
 * reception, etc.) — a sponsor rep's `/api/public/activities` call already
 * returns the entire public schedule (they see everything a participant
 * does), so this filters client-side to just the items that involve
 * sponsors, and renders them with the same day-grouped timeline the public
 * `/horario` page uses, extended to reveal each item's responsible
 * person(s)/contact note (never shown on the public timeline).
 */
function SponsorScheduleCard() {
  const { t } = useLocale();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [items, setItems] = useState<PublicScheduleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.get<PublicEvent>("/api/public/event"), logisticsApi.publicSchedule()])
      .then(([eventData, schedule]) => {
        setEvent(eventData);
        setItems(schedule.items);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t("couldNotLoadSchedule"));
      });
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const sponsorItems = items?.filter((item) => item.audiences?.includes("sponsor")) ?? null;

  return (
    <SectionCard icon={CalendarClockIcon} title={t("whatsHappeningTitle")}>
      {error ? (
        <ContextualError message={error} onRetry={load} />
      ) : sponsorItems === null || !event ? (
        <Spinner className="size-5" />
      ) : sponsorItems.length === 0 ? (
        <EmptyState title={t("noSponsorScheduleItemsYet")} />
      ) : (
        <ScheduleTimeline items={sponsorItems} timezone={event.timezone} showResponsible />
      )}
    </SectionCard>
  );
}
