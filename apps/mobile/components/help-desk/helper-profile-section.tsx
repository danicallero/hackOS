import { useRouter } from "expo-router";
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
import type { DirectoryEntry } from "@/lib/directory";
import {
  type AvailabilityInterval,
  availabilityDays,
  type HelpTopic,
  helpMutation,
  type MyHelperProfile,
  validAvailability,
} from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { useHelpResource } from "@/lib/use-help-resource";
import { colors, type } from "@/theme";
import { TopicField } from "./primitives";

const HOUR = 3_600_000;
const MAX_INTERVALS = 30;

/** The interval being edited in the sheet: `index` is null for a new one. */
interface Editing {
  index: number | null;
  startsAt: Date;
  endsAt: Date;
}

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

/**
 * H61, H62: the help desk part of the public profile editor, shown to eligible
 * helpers below their profile card. It extends the same profile (the bio and
 * identity are the card's) with publication, knowledge and dated availability.
 * Each change saves at once, like the profile's share switch; availability is
 * edited one interval at a time in a sheet (Starts / Ends, as Calendar does)
 * and saved as the complete replacement the API expects.
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
  const [editing, setEditing] = useState<Editing | null>(null);

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

  async function run(request: () => Promise<MyHelperProfile<DirectoryEntry>>): Promise<boolean> {
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

  const saveProfile = (published: boolean, topics: HelpTopic[]) =>
    run(() =>
      helpMutation<MyHelperProfile<DirectoryEntry>>(
        "/api/me/helper-profile",
        { published, topicIds: topics.map((topic) => topic.id) },
        "PUT",
      ),
    );

  const saveOwnChallengesOnly = (ownChallengesOnly: boolean) =>
    run(() =>
      helpMutation<MyHelperProfile<DirectoryEntry>>(
        "/api/me/helper-profile",
        {
          published: profile?.published ?? false,
          topicIds: (profile?.topics ?? []).map((topic) => topic.id),
          ownChallengesOnly,
        },
        "PUT",
      ),
    );

  const saveAvailability = (intervals: AvailabilityInterval[]) =>
    run(() =>
      helpMutation<MyHelperProfile<DirectoryEntry>>(
        "/api/me/helper-profile/availability",
        { intervals },
        "PUT",
      ),
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
    void latest.current.saveProfile(current.published && topics.length > 0, topics);
  }, []);

  useEffect(() => {
    if (profile) onProfileChange?.(profile);
  }, [profile, onProfileChange]);

  if (!profile?.eligible) {
    return error ? <RequestFeedback error={error} onRetry={() => void load()} /> : null;
  }

  const intervals = profile.availability;
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
  function addInterval() {
    const last = intervals[intervals.length - 1];
    const suggested = intervals.length === 0 ? profile?.suggestedInterval : null;
    const start = last ? Date.parse(last.endsAt) : Math.ceil(Date.now() / HOUR) * HOUR;
    setError(null);
    setEditing(
      suggested
        ? {
            index: null,
            startsAt: new Date(suggested.startsAt),
            endsAt: new Date(suggested.endsAt),
          }
        : { index: null, startsAt: new Date(start), endsAt: new Date(start + 2 * HOUR) },
    );
  }

  return (
    <>
      <Section footer={t("helpPublicationNote")}>
        <ToggleRow
          label={t("helpPublish")}
          value={profile.published}
          disabled={busy || (!profile.published && profile.topics.length === 0)}
          onChange={(published) => void saveProfile(published, profile.topics)}
        />
        <Separator inset={16} />
        <TopicField
          selected={profile.topics}
          onChange={changeTopics}
          maximum={20}
          allowAdd
          disabled={busy}
        />
      </Section>
      <Section title={t("helpPlanTitle")} footer={t("helpPlanNote")}>
        {availabilityDays(intervals, language).flatMap((day) =>
          day.ranges.map((range) => (
            <View key={`${day.key}-${range.index}`}>
              <NavRow
                title={day.label}
                value={range.label}
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
          )),
        )}
        <NavRow
          icon="plus.circle.fill"
          chevron={false}
          title={t("helpAddInterval")}
          disabled={busy || intervals.length >= MAX_INTERVALS}
          onPress={addInterval}
        />
      </Section>
      {profile.canLimitToChallenges ? (
        <Section footer={profile.ownChallenges.map((challenge) => challenge.name).join(", ")}>
          <ToggleRow
            label={t("helpOnlyMyChallenges")}
            value={profile.ownChallengesOnly}
            disabled={busy}
            onChange={(value) => void saveOwnChallengesOnly(value)}
          />
        </Section>
      ) : null}
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
    </>
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
