"use client";

// Sponsor-only logistics/FAQ (H58): venue/parking/wifi, load-in window, merch
// drop-off deadline, point of contact — kept current by the organizing team
// so sponsor reps stop having to dig through email/Discord threads for it.
// Deliberately not public (unlike /horario) and not judge-visible (unlike
// challenges' challenge-directory access) — see requireSponsorPortalAccess.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { ContextualError } from "@/components/common/contextual-error";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import { ApiError, api } from "@/lib/api";
import { type I18nText, useLocale } from "@/lib/i18n";
import { useCan, useMe } from "@/lib/session";
import { MultilingualInput } from "../challenges/builders";
import { EMPTY_I18N, textForDisplay } from "../challenges/shared";

interface SponsorFaqResponse {
  contentI18n: I18nText;
}

export default function SponsorFaqPage() {
  const { t } = useLocale();
  const me = useMe();
  const canManage = useCan(CAPABILITIES.SPONSORS_MANAGE);
  const canView = canManage || Boolean(me?.isSponsorRep);

  const [content, setContent] = useState<I18nText | null>(null);
  const [draft, setDraft] = useState<I18nText>(EMPTY_I18N);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .get<SponsorFaqResponse>("/api/sponsor-faq")
      .then((r) => {
        setContent(r.contentI18n);
        setDraft(r.contentI18n);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t("couldNotLoadSponsorFaq"));
      });
  }, [t]);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  if (!canView) return <AccessDenied ask={t("sponsorFaq")} />;
  if (error) return <ContextualError message={error} onRetry={load} />;
  if (content === null) return <Spinner className="size-5" />;

  const displayText = textForDisplay(content);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.put<SponsorFaqResponse>("/api/sponsor-faq", { contentI18n: draft });
      setContent(r.contentI18n);
      setDraft(r.contentI18n);
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
      {canManage ? (
        <form onSubmit={handleSubmit}>
          <SectionCard title={t("sponsorFaq")}>
            <MultilingualInput label={t("sponsorFaq")} textarea value={draft} onChange={setDraft} />
            <div className="flex justify-end pt-2">
              <SubmitButton pending={saving}>{t("save")}</SubmitButton>
            </div>
          </SectionCard>
        </form>
      ) : (
        <SectionCard title={t("sponsorFaq")}>
          {displayText.trim() ? (
            <p className="text-pretty whitespace-pre-wrap text-sm">{displayText}</p>
          ) : (
            <p className="text-muted-foreground text-sm">{t("noSponsorFaqYet")}</p>
          )}
        </SectionCard>
      )}
    </div>
  );
}
