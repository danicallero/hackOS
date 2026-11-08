"use client";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useId, useState } from "react";
import { DateTimeInput } from "@/components/common/datetime-input";
import { FormActions } from "@/components/common/form-actions";
import { IconButton } from "@/components/common/icon-button";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { BioField, SwitchRow } from "@/components/profile/public-profile-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useServerResource } from "@/hooks/use-server-resource";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { api } from "@/lib/api";
import { fromDatetimeLocal, getTimeZoneLabel, toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { MyHelperProfile } from "../model";
import { validIntervals } from "../model";
import { HelpdeskError, HelpdeskLoading, HelperPresence, TopicsPicker } from "../shared";

export default function HelperProfilePage() {
  const { t } = useLocale();
  const resource = useServerResource(["helpdesk", "own-profile"], (signal) =>
    api.get<MyHelperProfile>("/api/me/helper-profile", { signal }),
  );
  return (
    <PageLayout width="reading">
      <PageHeader reserveNavigation={false} title={t("helpDeskProfile")} />
      {resource.error ? <HelpdeskError error={resource.error} retry={resource.reload} /> : null}
      {resource.loading ? (
        <HelpdeskLoading />
      ) : resource.data ? (
        resource.data.eligible ? (
          <>
            <ProfileEditor
              key={`profile-${resource.data.publishedAt}-${resource.data.bio}-${resource.data.topics.map((x) => x.id).join(",")}`}
              profile={resource.data}
              onSaved={resource.mutate}
            />
            <ScheduleEditor
              key={JSON.stringify(resource.data.availability)}
              profile={resource.data}
              onSaved={resource.mutate}
            />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t("helpDeskNotEligible")}</p>
        )
      ) : null}
    </PageLayout>
  );
}
function ProfileEditor({
  profile,
  onSaved,
}: {
  profile: MyHelperProfile;
  onSaved: (profile: MyHelperProfile) => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const [published, setPublished] = useState(profile.published);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [topics, setTopics] = useState(profile.topics);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dirty =
    published !== profile.published ||
    bio !== (profile.bio ?? "") ||
    topics.map((x) => x.id).join(",") !== profile.topics.map((x) => x.id).join(",");
  useUnsavedChangesGuard(dirty);
  return (
    <SectionCard variant="plain" title={profile.preview.displayName}>
      <form
        className="space-y-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          try {
            const saved = await api.put<MyHelperProfile>("/api/me/helper-profile", {
              published,
              bio,
              topicIds: topics.map((topic) => topic.id),
            });
            onSaved(saved);
            toast.success(t("helpDeskSaved"));
          } catch (err) {
            setError(err);
          } finally {
            setPending(false);
          }
        }}
      >
        <fieldset disabled={pending} className="space-y-5">
          <SwitchRow checked={published} onChange={setPublished} label={t("helpDeskPublish")} />
          <p className="text-muted-foreground text-sm text-pretty">{t("helpDeskPublishingNote")}</p>
          <BioField value={bio} onChange={setBio} />
          <p className="text-muted-foreground text-sm">{t("helpDeskBioShared")}</p>
          <div className="space-y-2">
            <Label htmlFor={id}>{t("helpDeskKnowledge")}</Label>
            <TopicsPicker id={id} value={topics} onChange={setTopics} disabled={pending} />
          </div>
        </fieldset>
        {error ? <HelpdeskError error={error} fallback="helpDeskSaveError" /> : null}
        <FormActions
          pending={pending}
          state={error ? "error" : dirty ? "unsaved" : "saved"}
          disabled={!dirty}
        />
      </form>
    </SectionCard>
  );
}
function ScheduleEditor({
  profile,
  onSaved,
}: {
  profile: MyHelperProfile;
  onSaved: (profile: MyHelperProfile) => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const [intervals, setIntervals] = useState(() =>
    profile.availability.map((item, index) => ({
      id: `saved-${index}`,
      start: toDatetimeLocal(item.startsAt),
      end: toDatetimeLocal(item.endsAt),
    })),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
  const original = profile.availability.map((item) => ({
    start: toDatetimeLocal(item.startsAt),
    end: toDatetimeLocal(item.endsAt),
  }));
  const dirty =
    JSON.stringify(intervals.map(({ start, end }) => ({ start, end }))) !==
    JSON.stringify(original);
  useUnsavedChangesGuard(dirty);
  return (
    <SectionCard variant="plain" title={t("helpDeskSchedule")}>
      <form
        className="space-y-5"
        onSubmit={async (event) => {
          event.preventDefault();
          const values = intervals.map((item) => ({
            startsAt: fromDatetimeLocal(item.start) ?? "",
            endsAt: fromDatetimeLocal(item.end) ?? "",
          }));
          if (!validIntervals(values)) {
            setInvalid(true);
            return;
          }
          setPending(true);
          setError(null);
          setInvalid(false);
          try {
            onSaved(
              await api.put<MyHelperProfile>("/api/me/helper-profile/availability", {
                intervals: values,
              }),
            );
          } catch (err) {
            setError(err);
          } finally {
            setPending(false);
          }
        }}
      >
        <p className="text-muted-foreground text-sm text-pretty">
          {t("helpDeskScheduleNote", { zone: getTimeZoneLabel() })}
        </p>
        <fieldset disabled={pending} className="space-y-4">
          {intervals.map((item, index) => (
            <div
              key={item.id}
              className="grid items-start gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto]"
            >
              <div className="min-w-0 space-y-2">
                <Label htmlFor={`${id}-${item.id}-start`}>{t("helpDeskStarts")}</Label>
                <DateTimeInput
                  id={`${id}-${item.id}-start`}
                  required
                  value={item.start}
                  onChange={(start) =>
                    setIntervals((items) =>
                      items.map((x) => (x.id === item.id ? { ...x, start } : x)),
                    )
                  }
                  aria-invalid={invalid}
                  aria-describedby={invalid ? `${id}-error` : undefined}
                />
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor={`${id}-${item.id}-end`}>{t("helpDeskEnds")}</Label>
                <DateTimeInput
                  id={`${id}-${item.id}-end`}
                  required
                  value={item.end}
                  onChange={(end) =>
                    setIntervals((items) =>
                      items.map((x) => (x.id === item.id ? { ...x, end } : x)),
                    )
                  }
                  aria-invalid={invalid}
                />
              </div>
              <IconButton
                type="button"
                className="sm:mt-7"
                label={t("helpDeskRemoveInterval", { number: index + 1 })}
                onClick={() => setIntervals((items) => items.filter((x) => x.id !== item.id))}
              >
                <XIcon aria-hidden="true" />
              </IconButton>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={pending || intervals.length >= 30}
            onClick={() =>
              setIntervals((items) => [...items, { id: crypto.randomUUID(), start: "", end: "" }])
            }
          >
            {t("helpDeskAddInterval")}
          </Button>
        </fieldset>
        {invalid ? (
          <p id={`${id}-error`} role="alert" className="text-destructive text-sm">
            {t("helpDeskInvalidInterval")}
          </p>
        ) : null}
        {error ? <HelpdeskError error={error} fallback="helpDeskSaveError" /> : null}
        <FormActions
          pending={pending}
          state={error ? "error" : dirty ? "unsaved" : "saved"}
          disabled={!dirty}
        />
      </form>
      <div className="mt-6 space-y-3">
        <HelperPresence helper={profile.preview} />
      </div>
    </SectionCard>
  );
}
