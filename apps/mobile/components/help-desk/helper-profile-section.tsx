import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { AdaptiveFrame } from "@/components/adaptive-frame";
import { SheetModal } from "@/components/app-sheet";
import { DateTimeField } from "@/components/date-time-field";
import { FloatingGlassButton, Section, Separator, ToggleRow } from "@/components/native-ui";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { apiFetch } from "@/lib/api";
import type { DirectoryEntry } from "@/lib/directory";
import { eventDayKey } from "@/lib/event-time";
import {
  type AvailabilityInterval,
  dayLabel,
  type HelpTopic,
  helpMutation,
  type MyHelperProfile,
  type PlanDay,
  planDays,
  slotInterval,
  validAvailability,
} from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { colors, type } from "@/theme";
import { AppText } from "../app-text";
import { AvailabilityTimeline } from "./availability-timeline";
import { TopicField } from "./primitives";

const HOUR = 3_600_000;

/** One stated stretch being added or changed in the sheet. */
interface Draft {
  /** The day line it was opened from. */
  label: string;
  /** Position in the saved intervals; null for a new one. */
  index: number | null;
  startsAt: Date;
  endsAt: Date;
}

/**
 * H61, H62: the help desk part of the public profile editor, below the card
 * (which supplies the bio and identity), in the order a helper decides:
 * Available to mentor (and, for sponsors, only their own challenges), what they
 * can help with, and the hours they plan to be around: one 24-hour line per
 * hacking day, as on the web. Touching a line adds a stretch there and touching
 * a stretch opens it, in a sheet that sets it by clock. Every change saves at once.
 */
export function HelperProfileSection({
  onProfileChange,
}: {
  onProfileChange?: (profile: MyHelperProfile<DirectoryEntry>) => void;
} = {}) {
  const { t, language } = useLocale();
  const router = useRouter();
  const [profile, setProfile] = useState<MyHelperProfile<DirectoryEntry> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const latest = useRef<{
    profile: MyHelperProfile<DirectoryEntry> | null;
    saveProfile: (
      published: boolean,
      topics: HelpTopic[],
      challengeIds?: number[],
    ) => Promise<boolean>;
  }>({ profile: null, saveProfile: async () => false });

  const load = useCallback(async () => {
    setError(null);
    try {
      setProfile(await apiFetch<MyHelperProfile<DirectoryEntry>>("/api/me/helper-profile"));
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    if (profile) onProfileChange?.(profile);
  }, [profile, onProfileChange]);

  // Saves are optimistic (no disabled or faded controls while one is in flight, so
  // toggling never flickers); the server's answer replaces the guess, and only
  // the latest answer counts when several are in flight.
  const sequence = useRef(0);
  async function save(
    optimistic: Partial<MyHelperProfile<DirectoryEntry>>,
    request: () => Promise<MyHelperProfile<DirectoryEntry>>,
  ): Promise<boolean> {
    const previous = latest.current.profile;
    const ticket = ++sequence.current;
    setError(null);
    if (previous) setProfile({ ...previous, ...optimistic });
    try {
      const saved = await request();
      if (ticket === sequence.current) setProfile(saved);
      return true;
    } catch (cause) {
      if (ticket === sequence.current && previous) setProfile(previous);
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      return false;
    }
  }
  const saveProfile = (published: boolean, topics: HelpTopic[], challengeIds?: number[]) =>
    save(
      {
        published,
        topics,
        ...(challengeIds === undefined
          ? {}
          : {
              challengeIds,
              challenges: (latest.current.profile?.challengeOptions ?? []).filter((option) =>
                challengeIds.includes(option.id),
              ),
            }),
      },
      () =>
        helpMutation<MyHelperProfile<DirectoryEntry>>(
          "/api/me/helper-profile",
          {
            published,
            topicIds: topics.map((topic) => topic.id),
            ...(challengeIds === undefined ? {} : { challengeIds }),
          },
          "PUT",
        ),
    );
  const saveAvailability = (intervals: AvailabilityInterval[]) =>
    save({ availability: intervals }, () =>
      helpMutation<MyHelperProfile<DirectoryEntry>>(
        "/api/me/helper-profile/availability",
        { intervals },
        "PUT",
      ),
    );

  // TopicField reports the picker's selection from an effect, so the callback
  // stays stable and ignores a selection equal to the saved one (no save loop).
  latest.current = { profile, saveProfile };
  const changeTopics = useCallback((topics: HelpTopic[]) => {
    const current = latest.current.profile;
    if (!current) return;
    const ids = (list: HelpTopic[]) => list.map((topic) => topic.id).join(",");
    if (ids(topics) === ids(current.topics)) return;
    void latest.current.saveProfile(current.published, topics, current.challengeIds);
  }, []);

  if (!profile?.eligible) {
    return error ? <RequestFeedback error={error} onRetry={() => void load()} /> : null;
  }
  const intervals = profile.availability;
  const window = profile.suggestedInterval;
  const days = planDays(window, intervals, language);

  function openNew(day: PlanDay, minute: number | null) {
    setError(null);
    // The day's plus continues after what is already stated, else starts at the usual hour.
    const last = day.ranges[day.ranges.length - 1];
    const interval =
      minute === null
        ? (() => {
            const start = Math.max(
              last ? Date.parse(last.interval.endsAt) + HOUR : day.anchor.getTime(),
              window ? Date.parse(window.startsAt) : 0,
            );
            return {
              startsAt: new Date(start).toISOString(),
              endsAt: new Date(start + 2 * HOUR).toISOString(),
            };
          })()
        : slotInterval(day.key, minute, intervals, window?.startsAt);
    setDraft({
      label: day.label,
      index: null,
      startsAt: new Date(interval.startsAt),
      endsAt: new Date(interval.endsAt),
    });
  }
  function openExisting(index: number) {
    const interval = intervals[index];
    if (!interval) return;
    setError(null);
    setDraft({
      label: dayLabel(interval.startsAt, language),
      index,
      startsAt: new Date(interval.startsAt),
      endsAt: new Date(interval.endsAt),
    });
  }
  function commit(next: AvailabilityInterval[]) {
    if (!validAvailability(next)) {
      setError(new Error(t("helpInvalidInterval")));
      return;
    }
    // Nobody is available before the hacking time (H62).
    if (window && next.some((item) => Date.parse(item.startsAt) < Date.parse(window.startsAt))) {
      setError(new Error(t("helpBeforeHacking")));
      return;
    }
    setBusy(true);
    void saveAvailability(next).then((saved) => {
      setBusy(false);
      if (saved) setDraft(null);
    });
  }
  function commitDraft() {
    if (!draft) return;
    commit([
      ...intervals.filter((_, index) => index !== draft.index),
      { startsAt: draft.startsAt.toISOString(), endsAt: draft.endsAt.toISOString() },
    ]);
  }
  const endsNextDay =
    draft !== null && eventDayKey(draft.endsAt) !== eventDayKey(draft.startsAt)
      ? dayLabel(draft.endsAt.toISOString(), language)
      : null;

  return (
    <>
      <Section title={t("helpDesk")}>
        <ToggleRow
          label={t("helpMentorAvailable")}
          value={profile.published}
          onChange={(published) => void saveProfile(published, profile.topics)}
        />
        {profile.challengeOptions.length > 0 ? (
          <>
            <Separator inset={16} />
            <NavRow
              title={t("helpChallengeAlerts")}
              value={
                profile.challenges.length === 0
                  ? t("helpAlertsAll")
                  : profile.challenges.map((challenge) => challenge.name).join(", ")
              }
              onPress={() => router.push("/help-helper-challenges")}
            />
          </>
        ) : null}
      </Section>
      <Section>
        <TopicField selected={profile.topics} onChange={changeTopics} maximum={20} allowAdd />
      </Section>
      <Section title={t("helpHoursTitle")}>
        <AvailabilityTimeline
          days={days}
          intervals={intervals}
          notBefore={window?.startsAt}
          onAdd={openNew}
          onEdit={openExisting}
        />
      </Section>
      {error && !draft ? <RequestFeedback error={error} message={error.message} /> : null}
      <SheetModal
        visible={draft !== null}
        animationType="slide"
        onRequestClose={() => setDraft(null)}
      >
        <AdaptiveFrame>
          <View style={{ alignItems: "center", height: 76, justifyContent: "center" }}>
            <Text
              accessibilityRole="header"
              style={{ color: colors.label, fontSize: type.body.fontSize, fontWeight: "600" }}
            >
              {draft?.label}
            </Text>
          </View>
          {draft ? (
            <View style={{ gap: 24, paddingHorizontal: 16 }}>
              <Section>
                <RangeRow
                  range={draft}
                  onChange={(patch) => setDraft({ ...draft, ...patch })}
                  endsNextDay={endsNextDay}
                />
                {draft.index !== null ? (
                  <>
                    <Separator inset={16} />
                    <NavRow
                      destructive
                      title={t("helpRemoveInterval")}
                      disabled={busy}
                      onPress={() => commit(intervals.filter((_, index) => index !== draft.index))}
                    />
                  </>
                ) : null}
              </Section>
              {error ? <RequestFeedback error={error} message={error.message} /> : null}
            </View>
          ) : null}
          <FloatingGlassButton
            top={16}
            side="left"
            icon="xmark"
            accessibilityLabel={t("cancel")}
            disabled={busy}
            onPress={() => setDraft(null)}
          />
          <FloatingGlassButton
            top={16}
            side="right"
            icon="checkmark"
            tintColor={colors.accent}
            accessibilityLabel={t("save")}
            accessibilityState={{ busy }}
            disabled={busy}
            onPress={commitDraft}
          />
        </AdaptiveFrame>
      </SheetModal>
    </>
  );
}

/**
 * One stretch by clock. An end at or before the start means the next day, so a
 * night shift needs no date field; the day it then ends on is shown beside it.
 */
function RangeRow({
  range,
  onChange,
  endsNextDay,
}: {
  range: { startsAt: Date; endsAt: Date };
  onChange: (patch: Partial<{ startsAt: Date; endsAt: Date }>) => void;
  endsNextDay: string | null;
}) {
  const { t } = useLocale();
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
        justifyContent: "space-between",
        minHeight: 50,
        paddingHorizontal: 16,
        paddingVertical: 8,
      }}
    >
      <DateTimeField
        timeOnly
        value={range.startsAt}
        onChange={(startsAt) => {
          // Moving the start keeps the duration, as Calendar does.
          const length = range.endsAt.getTime() - range.startsAt.getTime();
          onChange({ startsAt, endsAt: new Date(startsAt.getTime() + length) });
        }}
        dateAccessibilityLabel={t("helpStart")}
        timeAccessibilityLabel={t("helpStart")}
      />
      <Text style={{ color: colors.secondaryLabel }}>–</Text>
      <DateTimeField
        timeOnly
        value={range.endsAt}
        onChange={(picked) => {
          let end = picked.getTime();
          const start = range.startsAt.getTime();
          while (end <= start) end += 24 * HOUR;
          while (end - start > 24 * HOUR) end -= 24 * HOUR;
          onChange({ endsAt: new Date(end) });
        }}
        dateAccessibilityLabel={t("helpEnd")}
        timeAccessibilityLabel={t("helpEnd")}
      />
      {endsNextDay ? (
        <AppText variant="footnote" tone="secondary">
          {endsNextDay}
        </AppText>
      ) : null}
    </View>
  );
}
