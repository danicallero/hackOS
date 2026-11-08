import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { DateTimeField } from "@/components/date-time-field";
import { ActionButton, Section, Separator, ToggleRow } from "@/components/native-ui";
import { NavRow, RowButton } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { apiFetch } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import {
  type AvailabilityInterval,
  type HelpTopic,
  helpMutation,
  type MyHelperProfile,
  validAvailability,
} from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { useMeContext } from "@/lib/me-context";
import { useHelpDraftGuard } from "@/lib/use-help-draft-guard";
import { colors, space, type } from "@/theme";
import { HelpInput, HelpPage, HelpText, TopicField } from "./primitives";

export function HelperProfileScreen() {
  const { t } = useLocale();
  const { me } = useMeContext();
  const [profile, setProfile] = useState<MyHelperProfile | null>(null);
  const [bio, setBio] = useState("");
  const [published, setPublished] = useState(false);
  const [topics, setTopics] = useState<HelpTopic[]>([]);
  const [intervals, setIntervals] = useState<(AvailabilityInterval & { draftKey: string })[]>([]);
  const [busy, setBusy] = useState<"profile" | "schedule" | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const apply = useCallback((next: MyHelperProfile) => {
    setProfile(next);
    setBio(next.bio ?? "");
    setPublished(next.published);
    setTopics(next.topics);
    setIntervals(
      next.availability.map((interval) => ({ ...interval, draftKey: createIdempotencyKey() })),
    );
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      apply(await apiFetch<MyHelperProfile>("/api/me/helper-profile"));
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setLoading(false);
    }
  }, [apply]);
  useEffect(() => {
    void load();
  }, [load]);
  const profileDirty =
    !!profile &&
    (bio !== (profile.bio ?? "") ||
      published !== profile.published ||
      JSON.stringify(topics) !== JSON.stringify(profile.topics));
  const scheduleDirty =
    !!profile &&
    JSON.stringify(intervals.map(({ startsAt, endsAt }) => ({ startsAt, endsAt }))) !==
      JSON.stringify(profile.availability);
  useHelpDraftGuard(profileDirty || scheduleDirty, !!busy);
  /** One Save for the profile and the schedule: each is its own request, profile first. */
  async function save() {
    if (busy) return;
    if (scheduleDirty && !validAvailability(intervals)) {
      setError(new Error(t("helpInvalidInterval")));
      return;
    }
    setError(null);
    setSaved(false);
    try {
      let next = profile;
      if (profileDirty) {
        setBusy("profile");
        next = await helpMutation<MyHelperProfile>(
          "/api/me/helper-profile",
          { bio: bio.trim() || null, published, topicIds: topics.map((topic) => topic.id) },
          "PUT",
        );
        setProfile(next);
        setBio(next.bio ?? "");
        setPublished(next.published);
        setTopics(next.topics);
      }
      if (scheduleDirty) {
        setBusy("schedule");
        next = await helpMutation<MyHelperProfile>(
          "/api/me/helper-profile/availability",
          { intervals: intervals.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })) },
          "PUT",
        );
        setProfile(next);
        setIntervals(
          next.availability.map((interval) => ({ ...interval, draftKey: createIdempotencyKey() })),
        );
      }
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(null);
    }
  }
  function changeInterval(index: number, patch: Partial<AvailabilityInterval>) {
    setSaved(false);
    setIntervals((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  const canSave = !busy && (profileDirty || scheduleDirty) && !(published && topics.length === 0);
  const changeTopics = useCallback((value: HelpTopic[]) => {
    setTopics(value);
    setSaved(false);
  }, []);
  return (
    <HelpPage
      title={t("helpMyProfile")}
      form
      showBack={!!me?.hasEventAccess}
      action={
        profile?.eligible
          ? { icon: "checkmark", label: t("save"), disabled: !canSave, onPress: () => void save() }
          : undefined
      }
    >
      <RequestFeedback
        loading={loading}
        error={error}
        message={error?.message}
        onRetry={!profile ? () => void load() : undefined}
      />
      {!me?.hasEventAccess ? (
        <ActionButton label={t("signOut")} onPress={() => void signOut()} />
      ) : null}
      {profile && !profile.eligible ? <HelpText>{t("helpNoAccess")}</HelpText> : null}
      {profile?.eligible ? (
        <>
          <Section footer={t("helpPublicationNote")}>
            <ToggleRow
              label={t("helpPublish")}
              value={published}
              disabled={!!busy}
              onChange={(value) => {
                setPublished(value);
                setSaved(false);
              }}
            />
          </Section>
          <Section footer={t("helpBioNote")}>
            <HelpInput
              label={t("networkingBio")}
              value={bio}
              onChange={(value) => {
                setBio(value);
                setSaved(false);
              }}
              maxLength={500}
              multiline
              disabled={!!busy}
            />
          </Section>
          <Section>
            <TopicField selected={topics} onChange={changeTopics} maximum={20} disabled={!!busy} />
          </Section>
          <Section title={t("helpSchedule")} footer={t("helpScheduleNote")}>
            {intervals.map((interval, index) => (
              <View key={interval.draftKey} pointerEvents={busy ? "none" : "auto"}>
                {index > 0 ? <Separator inset={0} /> : null}
                <IntervalField
                  label={t("helpStart")}
                  value={new Date(interval.startsAt)}
                  onChange={(date) => changeInterval(index, { startsAt: date.toISOString() })}
                />
                <Separator inset={16} />
                <IntervalField
                  label={t("helpEnd")}
                  value={new Date(interval.endsAt)}
                  onChange={(date) => changeInterval(index, { endsAt: date.toISOString() })}
                />
                <Separator inset={16} />
                <View style={{ paddingHorizontal: space.md }}>
                  <RowButton
                    label={t("helpRemoveInterval")}
                    destructive
                    onPress={() => {
                      setIntervals((items) => items.filter((_, i) => i !== index));
                      setSaved(false);
                    }}
                  />
                </View>
              </View>
            ))}
            {intervals.length ? <Separator inset={0} /> : null}
            <NavRow
              icon="plus.circle"
              chevron={false}
              title={t("helpAddInterval")}
              onPress={() => {
                if (busy || intervals.length >= 30) return;
                const start = intervals.length
                  ? new Date(intervals[intervals.length - 1].endsAt).getTime()
                  : Date.now();
                setIntervals((items) => [
                  ...items,
                  {
                    draftKey: createIdempotencyKey(),
                    startsAt: new Date(start).toISOString(),
                    endsAt: new Date(start + 3_600_000).toISOString(),
                  },
                ]);
                setSaved(false);
              }}
            />
          </Section>
          {saved ? <HelpText secondary>{t("helpSaved")}</HelpText> : null}
        </>
      ) : null}
    </HelpPage>
  );
}

/** A labelled date-and-time row: caption on the left, the native pickers trailing. */
function IntervalField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date;
  onChange: (date: Date) => void;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: space.md,
        justifyContent: "space-between",
        minHeight: 56,
        paddingHorizontal: space.lg,
        paddingVertical: space.row,
      }}
    >
      <Text style={{ ...type.body, color: colors.label }}>{label}</Text>
      <DateTimeField
        value={value}
        onChange={onChange}
        dateAccessibilityLabel={label}
        timeAccessibilityLabel={label}
      />
    </View>
  );
}
