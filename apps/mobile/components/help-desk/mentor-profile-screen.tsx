import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { AdaptiveFrame } from "@/components/adaptive-frame";
import { SheetModal } from "@/components/app-sheet";
import { DateTimeField } from "@/components/date-time-field";
import { FloatingGlassButton, Section, Separator, ToggleRow } from "@/components/native-ui";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { confirmDestructive } from "@/lib/alert";
import { apiFetch } from "@/lib/api";
import {
  type AvailabilityInterval,
  type HelpTopic,
  helpMutation,
  type MyHelperProfile,
  planDays,
  validAvailability,
} from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { colors, type } from "@/theme";
import { HelpPage, TopicField } from "./primitives";

const HOUR = 3_600_000;
const MAX_INTERVALS = 30;

/** The interval being edited in the sheet: `index` is null for a new one. */
interface Editing {
  index: number | null;
  startsAt: Date;
  endsAt: Date;
}

/**
 * H61, H62: the mentor profile, one level below the public profile editor's
 * "Available to mentor" row. Sponsors first choose to hear only about their own
 * challenges; then the knowledge areas; then the plan, one section per hacking
 * day with the hours stated that day. Each change saves at once; hours are
 * edited one range at a time in a sheet (Starts / Ends, as Calendar does) and
 * saved as the complete replacement the API expects.
 */
export function MentorProfileScreen() {
  const { t, language } = useLocale();
  const [profile, setProfile] = useState<MyHelperProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProfile(await apiFetch<MyHelperProfile>("/api/me/helper-profile"));
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(request: () => Promise<MyHelperProfile>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      setProfile(await request());
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const saveProfile = (published: boolean, topics: HelpTopic[], ownChallengesOnly?: boolean) =>
    run(() =>
      helpMutation<MyHelperProfile>(
        "/api/me/helper-profile",
        {
          published,
          topicIds: topics.map((topic) => topic.id),
          ...(ownChallengesOnly === undefined ? {} : { ownChallengesOnly }),
        },
        "PUT",
      ),
    );

  const saveAvailability = (intervals: AvailabilityInterval[]) =>
    run(() =>
      helpMutation<MyHelperProfile>("/api/me/helper-profile/availability", { intervals }, "PUT"),
    );

  // TopicField reports the picker's selection from an effect, so the callback
  // stays stable and ignores a selection equal to the saved one (no save loop).
  const latest = useRef({ profile, saveProfile });
  latest.current = { profile, saveProfile };
  const changeTopics = useCallback((topics: HelpTopic[]) => {
    const current = latest.current.profile;
    if (!current) return;
    const ids = (list: HelpTopic[]) => list.map((topic) => topic.id).join(",");
    if (ids(topics) === ids(current.topics)) return;
    // Removing the last topic also withdraws the profile: a published helper needs knowledge.
    void latest.current.saveProfile(
      current.published && topics.length > 0,
      topics,
      current.ownChallengesOnly,
    );
  }, []);

  if (!profile?.eligible) {
    return (
      <HelpPage title={t("helpMentorProfile")} inlineTitle>
        {error ? <RequestFeedback error={error} onRetry={() => void load()} /> : null}
        {!error && !profile ? <RequestFeedback loading /> : null}
      </HelpPage>
    );
  }

  const intervals = profile.availability;
  const days = planDays(profile.suggestedInterval, intervals, language);

  function commitEditing() {
    if (!editing) return;
    const next = { startsAt: editing.startsAt.toISOString(), endsAt: editing.endsAt.toISOString() };
    const replaced =
      editing.index === null
        ? [...intervals, next]
        : intervals.map((item, index) => (index === editing.index ? next : item));
    if (!validAvailability(replaced)) {
      setError(new Error(t("helpInvalidInterval")));
      return;
    }
    void saveAvailability(replaced).then((saved) => saved && setEditing(null));
  }
  function removeEditing() {
    if (editing?.index == null) return;
    const index = editing.index;
    confirmDestructive({
      title: t("helpRemoveInterval"),
      confirm: t("remove"),
      cancel: t("cancel"),
      onConfirm: () =>
        void saveAvailability(intervals.filter((_, i) => i !== index)).then(
          (saved) => saved && setEditing(null),
        ),
    });
  }
  function addHours(anchor: Date) {
    const windowEnd = profile?.suggestedInterval
      ? Date.parse(profile.suggestedInterval.endsAt)
      : Number.POSITIVE_INFINITY;
    const start = anchor.getTime();
    setError(null);
    setEditing({
      index: null,
      startsAt: new Date(start),
      endsAt: new Date(Math.max(start + HOUR, Math.min(start + 2 * HOUR, windowEnd))),
    });
  }

  return (
    <HelpPage title={t("helpMentorProfile")} inlineTitle>
      {profile.canLimitToChallenges ? (
        <Section footer={profile.ownChallenges.map((challenge) => challenge.name).join(", ")}>
          <ToggleRow
            label={t("helpOnlyMyChallenges")}
            value={profile.ownChallengesOnly}
            disabled={busy}
            onChange={(value) => void saveProfile(profile.published, profile.topics, value)}
          />
        </Section>
      ) : null}
      <Section title={t("helpKnowledgeTitle")}>
        <TopicField
          selected={profile.topics}
          onChange={changeTopics}
          maximum={20}
          allowAdd
          disabled={busy}
        />
      </Section>
      {days.map((day, dayIndex) => (
        <Section
          key={day.key}
          title={day.label}
          footer={dayIndex === 0 ? t("helpPlanNote") : undefined}
        >
          {day.ranges.map((range) => (
            <View key={range.index}>
              <NavRow
                title={range.label}
                disabled={busy}
                onPress={() => {
                  setError(null);
                  setEditing({
                    index: range.index,
                    startsAt: new Date(range.interval.startsAt),
                    endsAt: new Date(range.interval.endsAt),
                  });
                }}
              />
              <Separator inset={16} />
            </View>
          ))}
          <NavRow
            icon="plus.circle.fill"
            chevron={false}
            title={t("helpAddInterval")}
            disabled={busy || intervals.length >= MAX_INTERVALS}
            onPress={() => addHours(day.anchor)}
          />
        </Section>
      ))}
      {error && !editing ? <RequestFeedback error={error} message={error.message} /> : null}
      <SheetModal
        visible={editing !== null}
        animationType="slide"
        onRequestClose={() => setEditing(null)}
      >
        <AdaptiveFrame>
          <View style={{ alignItems: "center", height: 76, justifyContent: "center" }}>
            <Text
              accessibilityRole="header"
              style={{ color: colors.label, fontSize: type.body.fontSize, fontWeight: "600" }}
            >
              {t(editing?.index == null ? "helpAddInterval" : "helpEditInterval")}
            </Text>
          </View>
          {editing ? (
            <View style={{ gap: 24, paddingHorizontal: 16 }}>
              <Section>
                <IntervalRow
                  label={t("helpStart")}
                  value={editing.startsAt}
                  onChange={(startsAt) => {
                    // Moving the start keeps the duration, as Calendar does.
                    const length = editing.endsAt.getTime() - editing.startsAt.getTime();
                    setEditing({
                      ...editing,
                      startsAt,
                      endsAt: new Date(startsAt.getTime() + length),
                    });
                  }}
                />
                <Separator inset={16} />
                <IntervalRow
                  label={t("helpEnd")}
                  value={editing.endsAt}
                  onChange={(endsAt) => setEditing({ ...editing, endsAt })}
                />
              </Section>
              {error ? <RequestFeedback error={error} message={error.message} /> : null}
              {editing.index !== null ? (
                <Section>
                  <NavRow
                    title={t("helpRemoveInterval")}
                    destructive
                    chevron={false}
                    disabled={busy}
                    onPress={removeEditing}
                  />
                </Section>
              ) : null}
            </View>
          ) : null}
          <FloatingGlassButton
            top={16}
            side="left"
            icon="xmark"
            accessibilityLabel={t("cancel")}
            disabled={busy}
            onPress={() => setEditing(null)}
          />
          <FloatingGlassButton
            top={16}
            side="right"
            icon="checkmark"
            tintColor={colors.accent}
            accessibilityLabel={t("save")}
            accessibilityState={{ busy }}
            disabled={busy}
            onPress={commitEditing}
          />
        </AdaptiveFrame>
      </SheetModal>
    </HelpPage>
  );
}

/** A labelled date-and-time row: caption leading, the native pickers trailing. */
function IntervalRow({
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
        gap: 12,
        justifyContent: "space-between",
        minHeight: 50,
        paddingHorizontal: 16,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: colors.label, fontSize: type.callout.fontSize }}>{label}</Text>
      <DateTimeField
        value={value}
        onChange={onChange}
        dateAccessibilityLabel={label}
        timeAccessibilityLabel={label}
      />
    </View>
  );
}
