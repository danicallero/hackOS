import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { AdaptiveFrame } from "@/components/adaptive-frame";
import { SheetModal } from "@/components/app-sheet";
import { DateTimeField } from "@/components/date-time-field";
import { FloatingGlassButton, Section, Separator, ToggleRow } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import type { DirectoryEntry } from "@/lib/directory";
import {
  type AvailabilityInterval,
  type HelpTopic,
  helpMutation,
  type MyHelperProfile,
  planDays,
  validAvailability,
} from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { useHelpResource } from "@/lib/use-help-resource";
import { colors, type } from "@/theme";
import { TopicField } from "./primitives";

/**
 * H61: the public profile editor's one Help desk row: On/Off is the published
 * state, and it opens the help desk settings page (`app/helper-profile.tsx`).
 * Nothing renders for people who cannot be helpers.
 */
export function HelperSettingsLink() {
  const { t } = useLocale();
  const router = useRouter();
  const result = useHelpResource<MyHelperProfile>("/api/me/helper-profile");
  const profile = result.data;
  if (!profile && result.error) {
    return <RequestFeedback error={result.error} onRetry={() => void result.load()} />;
  }
  if (!profile?.eligible) return null;
  return (
    <Section>
      <NavRow
        icon="lifepreserver"
        title={t("helpDesk")}
        value={t(profile.published ? "helpOn" : "helpOff")}
        onPress={() => router.push("/helper-profile")}
      />
    </Section>
  );
}

const HOUR = 3_600_000;
let nextRangeId = 0;

/** One day's ranges being edited in the sheet. */
interface DayDraft {
  key: string;
  label: string;
  /** Positions in the saved intervals this draft replaces. */
  replaces: number[];
  ranges: { id: number; startsAt: Date; endsAt: Date }[];
}

/**
 * H61, H62: the help desk part of the public profile editor, below the card
 * (which supplies the bio and identity), in the order a helper decides:
 * Available to mentor (and, for sponsors, only their own challenges), what they
 * can help with, and the hours they plan to be around. Typical working hours
 * fill the plan in one tap; each day is one row whose sheet edits that day's
 * ranges by clock only. Every change saves at once.
 */
export function HelperProfileSection({
  onProfileChange,
}: {
  onProfileChange?: (profile: MyHelperProfile<DirectoryEntry>) => void;
} = {}) {
  const { t, language } = useLocale();
  const [profile, setProfile] = useState<MyHelperProfile<DirectoryEntry> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [draft, setDraft] = useState<DayDraft | null>(null);
  const [picking, setPicking] = useState(false);
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
  useEffect(() => {
    void load();
  }, [load]);
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

  function openDay(day: ReturnType<typeof planDays>[number]) {
    setError(null);
    const ranges = day.ranges.map((range) => ({
      id: nextRangeId++,
      startsAt: new Date(range.interval.startsAt),
      endsAt: new Date(range.interval.endsAt),
    }));
    setDraft({
      key: day.key,
      label: day.label,
      replaces: day.ranges.map((range) => range.index),
      ranges:
        ranges.length > 0
          ? ranges
          : [
              {
                id: nextRangeId++,
                startsAt: day.anchor,
                endsAt: new Date(day.anchor.getTime() + 2 * HOUR),
              },
            ],
    });
  }
  function commitDay() {
    if (!draft) return;
    const kept = intervals.filter((_, index) => !draft.replaces.includes(index));
    const replaced = [
      ...kept,
      ...draft.ranges.map((range) => ({
        startsAt: range.startsAt.toISOString(),
        endsAt: range.endsAt.toISOString(),
      })),
    ];
    if (!validAvailability(replaced)) {
      setError(new Error(t("helpInvalidInterval")));
      return;
    }
    // Nobody is available before the hacking time (H62).
    if (
      window &&
      replaced.some((item) => Date.parse(item.startsAt) < Date.parse(window.startsAt))
    ) {
      setError(new Error(t("helpBeforeHacking")));
      return;
    }
    setBusy(true);
    void saveAvailability(replaced).then((saved) => {
      setBusy(false);
      if (saved) setDraft(null);
    });
  }
  function addRange() {
    if (!draft) return;
    const last = draft.ranges[draft.ranges.length - 1];
    const start = last ? last.endsAt.getTime() + HOUR : Date.now();
    setDraft({
      ...draft,
      ranges: [
        ...draft.ranges,
        { id: nextRangeId++, startsAt: new Date(start), endsAt: new Date(start + 2 * HOUR) },
      ],
    });
  }
  function updateRange(index: number, patch: Partial<{ startsAt: Date; endsAt: Date }>) {
    if (!draft) return;
    setDraft({
      ...draft,
      ranges: draft.ranges.map((range, i) => (i === index ? { ...range, ...patch } : range)),
    });
  }

  return (
    <>
      <Section>
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
                  ? t("helpAllRequests")
                  : profile.challenges.map((challenge) => challenge.name).join(", ")
              }
              onPress={() => setPicking(true)}
            />
          </>
        ) : null}
      </Section>
      <Section>
        <TopicField selected={profile.topics} onChange={changeTopics} maximum={20} allowAdd />
      </Section>
      <Section title={t("helpHoursTitle")}>
        {days.map((day, index) => (
          <View key={day.key}>
            <NavRow
              title={day.label}
              value={day.ranges.map((range) => range.label).join(", ") || undefined}
              onPress={() => openDay(day)}
            />
            {index < days.length - 1 ? <Separator inset={16} /> : null}
          </View>
        ))}
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
                {draft.ranges.map((range, index) => (
                  <View key={range.id}>
                    <RangeRow
                      range={range}
                      onChange={(patch) => updateRange(index, patch)}
                      onRemove={() =>
                        setDraft({ ...draft, ranges: draft.ranges.filter((_, i) => i !== index) })
                      }
                      removeLabel={t("helpRemoveInterval")}
                    />
                    <Separator inset={16} />
                  </View>
                ))}
                <NavRow
                  icon="plus.circle.fill"
                  chevron={false}
                  title={t("helpAddInterval")}
                  disabled={draft.ranges.length >= 6}
                  onPress={addRange}
                />
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
            onPress={commitDay}
          />
        </AdaptiveFrame>
      </SheetModal>
      <SheetModal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <AdaptiveFrame>
          <View style={{ alignItems: "center", height: 76, justifyContent: "center" }}>
            <Text
              accessibilityRole="header"
              style={{ color: colors.label, fontSize: type.body.fontSize, fontWeight: "600" }}
            >
              {t("helpChallengeAlerts")}
            </Text>
          </View>
          <View style={{ gap: 24, paddingHorizontal: 16 }}>
            <Section footer={t("helpChallengeAlertsNote")}>
              {profile.challengeOptions.map((option, index) => {
                const selected = profile.challengeIds.includes(option.id);
                return (
                  <View key={option.id}>
                    <NavRow
                      title={option.name}
                      chevron={false}
                      icon={selected ? "checkmark.circle.fill" : "circle"}
                      accessibilityLabel={option.name}
                      onPress={() =>
                        void saveProfile(
                          profile.published,
                          profile.topics,
                          selected
                            ? profile.challengeIds.filter((id) => id !== option.id)
                            : [...profile.challengeIds, option.id],
                        )
                      }
                    />
                    {index < profile.challengeOptions.length - 1 ? <Separator inset={16} /> : null}
                  </View>
                );
              })}
            </Section>
          </View>
          <FloatingGlassButton
            top={16}
            side="right"
            icon="checkmark"
            tintColor={colors.accent}
            accessibilityLabel={t("save")}
            onPress={() => setPicking(false)}
          />
        </AdaptiveFrame>
      </SheetModal>
    </>
  );
}

/** One range of the day: from and to by clock, and a remove control. */
function RangeRow({
  range,
  onChange,
  onRemove,
  removeLabel,
}: {
  range: { startsAt: Date; endsAt: Date };
  onChange: (patch: Partial<{ startsAt: Date; endsAt: Date }>) => void;
  onRemove: () => void;
  removeLabel: string;
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
        onChange={(endsAt) => onChange({ endsAt })}
        dateAccessibilityLabel={t("helpEnd")}
        timeAccessibilityLabel={t("helpEnd")}
      />
      <PressableFeedback
        feedback="opacity"
        accessibilityRole="button"
        accessibilityLabel={removeLabel}
        onPress={onRemove}
        hitSlop={8}
      >
        <SymbolView name="minus.circle.fill" size={22} tintColor={colors.destructive} />
      </PressableFeedback>
    </View>
  );
}
