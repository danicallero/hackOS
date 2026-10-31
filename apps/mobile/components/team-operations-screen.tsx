import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { interpolate, type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveFrame } from "@/components/adaptive-frame";
import { AppActivityIndicator } from "@/components/app-activity-indicator";
import { SheetModal } from "@/components/app-sheet";
import { EntryBackToolbar } from "@/components/header-back-button";
import {
  EmptyState,
  FloatingGlassButton,
  InfoRow,
  Section,
  Separator,
  StatusPill,
} from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { alert } from "@/lib/alert";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { isPadIdiom } from "@/lib/tabs";
import { radius, type } from "@/theme";
import { colors } from "@/theme/colors";
import { isAccessibilityTextSize } from "@/theme/dynamic-type";
import { useOperatorListColumn } from "@/theme/layout-screens";

interface TeamMember {
  userId: number | null;
  email: string;
  name: string | null;
  surname: string | null;
}

interface TeamEntry {
  id: number;
  challenge_id: number;
  repo_id: number;
  status: string;
  position: number | null;
  eta_minutes: number | null;
  call_count: number;
  repo_name?: string;
  repo_description?: string | null;
  repo_github_url?: string | null;
  repo_demo_url?: string | null;
  repo_members?: TeamMember[];
}

interface MemberCandidate {
  id: number;
  email: string;
  name: string | null;
  surname: string | null;
}

interface RoomView {
  room: { id: number; name: string; location: string | null };
  challenge: { id: number; title: string; enterprise_name: string } | null;
  active: TeamEntry | null;
  called: TeamEntry[];
  next: TeamEntry[];
}

interface RepoChallenge {
  /** The team's queue entry for this challenge. */
  entry_id: number;
  id: number;
  title: string;
  status: string;
  position: number | null;
  eta_minutes: number | null;
  call_count: number;
  queue_group_id: number | null;
  room_id: number | null;
  room_name: string | null;
  judging_rooms: Array<{ id: number; name: string }>;
}

interface HistoryRow {
  id: number;
  previous_status: string;
  new_status: string;
  action: string;
  reason: string | null;
  created_at: string;
  actor_name: string | null;
  actor_surname: string | null;
}

const QUEUE_STAGE_RANK: Record<string, number> = {
  presenting: 0,
  in_room: 1,
  called: 2,
  waiting: 3,
  completed: 4,
};

/**
 * Challenges that share one queue are one place in line: every one of them
 * shows the team's furthest-along entry (status, rank, wait, room, calls).
 */
function shareQueueInfo(challenges: RepoChallenge[]): RepoChallenge[] {
  const canonical = new Map<number, RepoChallenge>();
  for (const challenge of challenges) {
    if (challenge.queue_group_id == null) continue;
    const current = canonical.get(challenge.queue_group_id);
    const rank = (item: RepoChallenge) => QUEUE_STAGE_RANK[item.status] ?? 5;
    if (
      !current ||
      rank(challenge) < rank(current) ||
      (rank(challenge) === rank(current) &&
        (challenge.position ?? Number.POSITIVE_INFINITY) <
          (current.position ?? Number.POSITIVE_INFINITY))
    )
      canonical.set(challenge.queue_group_id, challenge);
  }
  return challenges.map((challenge) => {
    const lead = challenge.queue_group_id == null ? null : canonical.get(challenge.queue_group_id);
    if (!lead || lead === challenge) return challenge;
    return {
      ...challenge,
      entry_id: lead.entry_id,
      status: lead.status,
      position: lead.position,
      eta_minutes: lead.eta_minutes,
      call_count: lead.call_count,
      room_id: lead.room_id,
      room_name: lead.room_name,
    };
  });
}

type TeamLoadState = "loading" | "ready" | "missing" | "error";

/** H21: search existing accounts before adding a team member. */
function useMemberCandidateSearch(t: ReturnType<typeof useLocale>["t"], enabled = true) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<MemberCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [searched, setSearched] = useState(false);

  const search = useCallback(
    async (rawQuery = query) => {
      const q = rawQuery.trim();
      if (!q) {
        setCandidates([]);
        setSearched(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await apiFetch<{ users: MemberCandidate[] }>(
          `/api/projects/member-candidates?q=${encodeURIComponent(q)}`,
        );
        setCandidates(result.users);
        setSearched(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause : new Error(t("teamDetailMemberSearchError")));
      } finally {
        setLoading(false);
      }
    },
    [query, t],
  );

  useEffect(() => {
    if (!enabled) return;
    const q = query.trim();
    if (q.length < 2) {
      setCandidates([]);
      setSearched(false);
      return;
    }
    const handle = setTimeout(() => {
      void search(q);
    }, 250);
    return () => clearTimeout(handle);
  }, [search, query, enabled]);

  return {
    query,
    setQuery,
    candidates,
    setCandidates,
    loading,
    error,
    setError,
    searched,
    setSearched,
    search,
  };
}

/** H29/H31 operator team detail: the participant's own queue card, with the extra context an operator needs. */
export function TeamOperationsScreen() {
  const accessibilityText = isAccessibilityTextSize(useWindowDimensions().fontScale);
  const listColumn = useOperatorListColumn();
  useColorScheme();
  const { entryId, roomId } = useLocalSearchParams<{ entryId: string; roomId: string }>();
  const headerNavigation = useNavigation(isPadIdiom() ? "/(tabs)/others" : undefined);
  const { t, language } = useLocale();
  const { me } = useMeContext();
  const insets = useSafeAreaInsets();
  const [entry, setEntry] = useState<TeamEntry | null>(null);
  const [room, setRoom] = useState<RoomView["room"] | null>(null);
  const [repoChallenges, setRepoChallenges] = useState<RepoChallenge[]>([]);
  const [selectedQueueIndex, setSelectedQueueIndex] = useState(0);
  const [selectedEntryHistory, setSelectedEntryHistory] = useState<HistoryRow[] | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadState, setLoadState] = useState<TeamLoadState>("loading");
  const memberSearch = useMemberCandidateSearch(t);
  const [memberMutationError, setMemberMutationError] = useState<Error | null>(null);
  const [memberMutation, setMemberMutation] = useState<string | null>(null);
  const [showAddChallenge, setShowAddChallenge] = useState(false);
  const [availableChallenges, setAvailableChallenges] = useState<
    Array<{ id: number; title: string }>
  >([]);
  const [availableChallengesLoading, setAvailableChallengesLoading] = useState(false);
  const [enrolling, setEnrolling] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const tabScrollRef = useRef<ScrollView>(null);
  const canEditProject =
    me?.capabilities.includes(CAPABILITIES.ADMIN_ALL) ||
    me?.capabilities.includes(CAPABILITIES.PROJECTS_EDIT) ||
    false;
  const load = useCallback(async () => {
    setError(null);
    setLoadState((current) => (current === "ready" ? current : "loading"));
    try {
      const view = await apiFetch<RoomView>(`/api/queue/rooms/${roomId}/view`);
      const targetEntryId = Number(entryId);
      const found = [view.active, ...view.called, ...view.next].find(
        (item) => item != null && Number(item.id) === targetEntryId,
      );
      if (!found || !view.room) {
        setEntry(null);
        setRoom(null);
        setRepoChallenges([]);
        setLoadState("missing");
        return;
      }
      setEntry(found ?? null);
      setRoom(view.room);
      setLoadState("ready");
      try {
        const challenges = await apiFetch<RepoChallenge[]>(
          `/api/queue/repos/${found.repo_id}/challenges`,
        );
        const shared = shareQueueInfo(challenges);
        setRepoChallenges(shared);
        const targetChallengeId = Number(found.challenge_id);
        const idx = shared.findIndex((qc) => Number(qc.id) === targetChallengeId);
        setSelectedQueueIndex(idx >= 0 ? idx : 0);
      } catch {
        setRepoChallenges([]);
        setSelectedQueueIndex(0);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(t("queueOpsNotifyError")));
      setLoadState("error");
    }
  }, [entryId, roomId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const teamName = entry?.repo_name ?? t("queueOpsUnnamedTeam");

  const addMember = useCallback(
    async (userId: number) => {
      if (!entry) return;

      setMemberMutation(`add:${userId}`);
      setMemberMutationError(null);
      try {
        await apiFetch(`/api/repos/${entry.repo_id}/members`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId }),
        });
        memberSearch.setQuery("");
        memberSearch.setCandidates([]);
        memberSearch.setSearched(false);
        await load();
      } catch (cause) {
        setMemberMutationError(
          cause instanceof Error ? cause : new Error(t("teamDetailMemberUpdateError")),
        );
      } finally {
        setMemberMutation(null);
      }
    },
    [entry, load, t, memberSearch.setQuery, memberSearch.setCandidates, memberSearch.setSearched],
  );

  const deleteMember = useCallback(
    async (member: TeamMember) => {
      if (!entry || member.userId === null) return;
      setMemberMutation(member.email);
      setMemberMutationError(null);
      try {
        await apiFetch(`/api/repos/${entry.repo_id}/members/${member.userId}`, {
          method: "DELETE",
        });
        await load();
      } catch (cause) {
        setMemberMutationError(
          cause instanceof Error ? cause : new Error(t("teamDetailMemberUpdateError")),
        );
      } finally {
        setMemberMutation(null);
      }
    },
    [entry, load, t],
  );

  const removeMember = useCallback(
    (member: TeamMember) => {
      if (member.userId === null) return;
      const name = memberDisplayName(member);
      const description = t("teamDetailRemoveMemberConfirm", { name });
      const actionLabel = t("teamDetailRemoveMember");
      alert(actionLabel, description, [
        { text: t("cancel"), style: "cancel" },
        {
          text: actionLabel,
          style: "destructive",
          onPress: () => deleteMember(member),
        },
      ]);
    },
    [deleteMember, t],
  );

  const selectedQueue = repoChallenges[selectedQueueIndex] ?? null;

  // The tab's own queue entry carries rank, wait and call count, wherever it is queued.
  const fetchTabData = useCallback(async (qc: RepoChallenge) => {
    setSelectedEntryHistory(null);
    setTabLoading(true);
    try {
      setSelectedEntryHistory(
        await apiFetch<HistoryRow[]>(`/api/queue/entries/${qc.entry_id}/history`),
      );
    } catch {
      setSelectedEntryHistory([]);
    } finally {
      setTabLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedQueue) {
      void fetchTabData(selectedQueue);
    }
  }, [selectedQueue, fetchTabData]);

  const openAddChallenge = useCallback(async () => {
    setShowAddChallenge(true);
    setAvailableChallengesLoading(true);
    try {
      const result = await apiFetch<{
        challenges: Array<{ id: number; title: string | Record<string, string> }>;
      }>("/api/challenges");
      const enrolledIds = new Set(repoChallenges.map((qc) => qc.id));
      setAvailableChallenges(
        result.challenges
          .filter((ch) => !enrolledIds.has(ch.id))
          .map((ch) => ({
            id: ch.id,
            title:
              typeof ch.title === "string" ? ch.title : (ch.title[language] ?? ch.title.en ?? ""),
          })),
      );
    } catch {
      setAvailableChallenges([]);
    } finally {
      setAvailableChallengesLoading(false);
    }
  }, [repoChallenges, language]);

  const closeAddChallenge = useCallback(() => {
    setShowAddChallenge(false);
    setAvailableChallenges([]);
  }, []);

  const enrollChallenge = useCallback(
    async (challengeId: number) => {
      if (!entry) return;
      setEnrolling(challengeId);
      try {
        await apiFetch(`/api/repos/${entry.repo_id}/challenges`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ challengeId }),
        });
        await load();
        closeAddChallenge();
      } catch {
      } finally {
        setEnrolling(null);
      }
    },
    [entry, load, closeAddChallenge],
  );

  const removeFromQueue = useCallback(
    (qc: RepoChallenge) => {
      if (!entry) return;
      const teamName = entry.repo_name ?? t("queueOpsUnnamedTeam");
      alert(
        t("teamDetailRemoveFromQueue"),
        t("teamDetailRemoveFromQueueConfirm", { team: teamName, challenge: qc.title }),
        [
          { text: t("cancel"), style: "cancel" },
          {
            text: t("teamDetailRemoveFromQueue"),
            style: "destructive",
            onPress: async () => {
              setRemoving(qc.id);
              try {
                await apiFetch(`/api/repos/${entry.repo_id}/challenges/${qc.id}`, {
                  method: "DELETE",
                });
                await load();
              } catch {
              } finally {
                setRemoving(null);
              }
            },
          },
        ],
      );
    },
    [entry, load, t],
  );

  useLayoutEffect(() => {
    headerNavigation.setOptions({
      title: entry ? teamName : "",
      headerLargeTitle: true,
      headerBackVisible: true,
      headerLeft: undefined,
      headerRight: undefined,
    });
  }, [headerNavigation, teamName, entry]);

  if (loadState === "loading") {
    return (
      <View
        style={{
          backgroundColor: colors.background,
          flex: 1,
          justifyContent: "center",
        }}
      >
        <RequestFeedback loading />
      </View>
    );
  }

  if (loadState === "error" && error) {
    return (
      <View style={{ backgroundColor: colors.background, flex: 1 }}>
        <RequestFeedback error={error} onRetry={() => void load()} />
      </View>
    );
  }

  if (loadState === "missing" || !entry || !room) {
    return (
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.background,
          flex: 1,
          justifyContent: "center",
        }}
      >
        <EmptyState
          icon="person.2"
          title={t("screenNotFoundTitle")}
          description={t("requestUnavailable")}
        />
      </View>
    );
  }

  const members = entry.repo_members ?? [];
  const links = [
    {
      icon: "chevron.left.slash.chevron.right" as const,
      label: t("teamDetailGithub"),
      url: entry.repo_github_url,
    },
    { icon: "play.rectangle" as const, label: t("teamDetailDemo"), url: entry.repo_demo_url },
  ].filter((link) => Boolean(link.url));

  return (
    <>
      <EntryBackToolbar fallback="/(tabs)/others" />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ ...listColumn, gap: 22, paddingBottom: 40, paddingTop: 16 }}
        style={{ backgroundColor: colors.background }}
      >
        {entry.status === "called" ? (
          <View
            accessibilityRole="alert"
            style={{
              backgroundColor: colors.successSurface,
              borderCurve: "continuous",
              borderRadius: radius.control,
              gap: 7,
              padding: 14,
            }}
          >
            <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
              <SymbolView
                name="door.left.hand.open"
                tintColor={colors.onSuccessSurface}
                size={22}
                accessible={false}
              />
              <Text
                style={{ ...type.body, color: colors.onSuccessSurface, flex: 1, fontWeight: "700" }}
              >
                {t("teamDetailAtDoor", { room: room.name })}
              </Text>
            </View>
            {room.location ? (
              <Text style={{ ...type.compact, color: colors.onSuccessSurface, paddingLeft: 30 }}>
                {room.location}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Section title={t("teamDetailMembers")}>
          {members.map((member, index) => (
            <View key={member.userId ?? member.email}>
              {index > 0 ? <Separator /> : null}
              <SwipeableMemberRow
                enabled={canEditProject && member.userId !== null}
                actionLabel={t("teamDetailRemoveMember")}
                onAction={() => removeMember(member)}
              >
                <View
                  accessible
                  accessibilityLabel={`${memberDisplayName(member)}, ${member.email}`}
                  style={{
                    flexDirection: "row",
                    gap: 12,
                    minHeight: 44,
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                  }}
                >
                  <View style={{ flex: 1, justifyContent: "center" }}>
                    <Text
                      selectable
                      numberOfLines={accessibilityText ? undefined : 1}
                      style={{ ...type.body, color: colors.label }}
                    >
                      {memberDisplayName(member)}
                    </Text>
                    <Text
                      selectable
                      numberOfLines={1}
                      style={{ ...type.subhead, color: colors.secondaryLabel }}
                    >
                      {member.email}
                    </Text>
                  </View>
                </View>
              </SwipeableMemberRow>
            </View>
          ))}
          {canEditProject ? (
            <>
              {members.length ? <Separator /> : null}
              <View style={{ gap: 8, padding: 16 }}>
                <Text style={{ ...type.subhead, color: colors.label, fontWeight: "600" }}>
                  {t("teamDetailAddMember")}
                </Text>
                <Text style={{ ...type.footnote, color: colors.secondaryLabel, lineHeight: 18 }}>
                  {t("teamDetailAddMemberHint")}
                </Text>
                <View
                  style={{
                    alignItems: "center",
                    backgroundColor: colors.elevatedSurface,
                    borderCurve: "continuous",
                    borderRadius: radius.chip,
                    flexDirection: "row",
                    gap: 8,
                    minHeight: 36,
                    paddingHorizontal: 8,
                  }}
                >
                  <Pressable
                    accessibilityLabel={t("teamDetailMemberSearch")}
                    accessibilityRole="button"
                    onPress={() => void memberSearch.search()}
                    // 15pt glyph in a 36pt field: stretch the touch box to 44x44 leftwards
                    // and vertically so it never overlaps the text input.
                    hitSlop={{ top: 15, bottom: 14, left: 29, right: 0 }}
                  >
                    <SymbolView name="magnifyingglass" tintColor={colors.tertiaryLabel} size={15} />
                  </Pressable>
                  <TextInput
                    accessibilityLabel={t("teamDetailMemberSearch")}
                    editable={memberMutation === null && !memberSearch.loading}
                    onChangeText={(value) => {
                      memberSearch.setQuery(value);
                      memberSearch.setCandidates([]);
                      memberSearch.setError(null);
                      memberSearch.setSearched(false);
                    }}
                    onSubmitEditing={() => void memberSearch.search()}
                    placeholder={t("teamDetailMemberSearchPlaceholder")}
                    placeholderTextColor={colors.tertiaryLabel}
                    returnKeyType="search"
                    value={memberSearch.query}
                    hitSlop={{ top: 4, bottom: 4 }}
                    style={{
                      ...type.body,
                      color: colors.label,
                      flex: 1,

                      minHeight: 36,
                    }}
                  />
                  {memberSearch.query.length > 0 ? (
                    <Pressable
                      accessibilityLabel={t("cancel")}
                      onPress={() => {
                        memberSearch.setQuery("");
                        memberSearch.setCandidates([]);
                        memberSearch.setError(null);
                        memberSearch.setSearched(false);
                      }}
                      // 16pt glyph at the field's trailing edge: stretch to 44x44 inward-out.
                      hitSlop={{ top: 14, bottom: 14, left: 0, right: 28 }}
                    >
                      <SymbolView
                        name="xmark.circle.fill"
                        tintColor={colors.tertiaryLabel}
                        size={16}
                        accessible={false}
                      />
                    </Pressable>
                  ) : null}
                </View>
                {memberSearch.error ? (
                  <RequestFeedback
                    error={memberSearch.error}
                    message={memberSearch.error.message}
                  />
                ) : null}
                {memberMutationError ? (
                  <RequestFeedback
                    error={memberMutationError}
                    message={memberMutationError.message}
                  />
                ) : null}
                {memberSearch.candidates.map((candidate) => (
                  <View key={candidate.id}>
                    <Separator inset={0} />
                    <View
                      style={{
                        alignItems: "center",
                        flexDirection: "row",
                        gap: 12,
                        minHeight: 44,
                        paddingVertical: 6,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          selectable
                          numberOfLines={accessibilityText ? undefined : 1}
                          style={{ ...type.body, color: colors.label }}
                        >
                          {memberCandidateName(candidate)}
                        </Text>
                        <Text
                          selectable
                          numberOfLines={1}
                          style={{ ...type.subhead, color: colors.secondaryLabel }}
                        >
                          {candidate.email}
                        </Text>
                      </View>
                      {memberMutation === `add:${candidate.id}` ? (
                        <AppActivityIndicator size="small" color={colors.accent} />
                      ) : (
                        <PressableFeedback
                          feedback="opacity"
                          accessibilityRole="button"
                          accessibilityLabel={t("teamDetailAddCandidate", {
                            name: memberCandidateName(candidate),
                          })}
                          disabled={memberMutation !== null}
                          onPress={() => void addMember(candidate.id)}
                          hitSlop={8}
                          style={{
                            minHeight: 44,
                            minWidth: 44,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text style={{ ...type.body, color: colors.accent }}>{t("add")}</Text>
                        </PressableFeedback>
                      )}
                    </View>
                  </View>
                ))}
                {!memberSearch.loading &&
                memberSearch.searched &&
                memberSearch.candidates.length === 0 ? (
                  <Text
                    selectable
                    style={{
                      ...type.footnote,
                      color: colors.secondaryLabel,

                      paddingTop: 4,
                      textAlign: "center",
                    }}
                  >
                    {t("teamDetailNoMemberCandidates")}
                  </Text>
                ) : null}
              </View>
            </>
          ) : null}
        </Section>

        {links.length ? (
          <Section title={t("teamDetailLinks")}>
            {links.map((link, index) => (
              <View key={link.label}>
                {index > 0 ? <Separator /> : null}
                <PressableFeedback
                  feedback="opacity"
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(link.url!)}
                  style={{}}
                >
                  <InfoRow
                    label={link.label}
                    value={link.url!}
                    icon={link.icon}
                    accessoryIcon="chevron.right"
                  />
                </PressableFeedback>
              </View>
            ))}
          </Section>
        ) : null}

        {repoChallenges.length > 0 ? (
          <View style={{ gap: 12 }}>
            <QueueTabBar
              challenges={repoChallenges}
              selectedIndex={selectedQueueIndex}
              onSelect={setSelectedQueueIndex}
              canEdit={canEditProject}
              onAdd={openAddChallenge}
              t={t}
              scrollRef={tabScrollRef}
            />
            {selectedQueue ? (
              <QueueDetailView
                queue={selectedQueue}
                history={tabLoading ? null : selectedEntryHistory}
                canEdit={canEditProject}
                onRemove={removeFromQueue}
                removing={removing}
                t={t}
              />
            ) : null}
          </View>
        ) : (
          <Section>
            <EmptyState
              icon="tray"
              title={t("teamDetailNoQueues")}
              description={t("teamDetailQueueEmpty")}
            />
          </Section>
        )}

        {showAddChallenge ? (
          <SheetModal animationType="slide" onRequestClose={closeAddChallenge}>
            <AdaptiveFrame>
              <ScrollView
                alwaysBounceVertical
                contentInsetAdjustmentBehavior="automatic"
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{
                  gap: 22,
                  padding: 16,
                  paddingBottom: Math.max(32, insets.bottom + 16),
                  paddingTop: 16,
                }}
              >
                <View style={{ justifyContent: "center", minHeight: 44, paddingHorizontal: 52 }}>
                  <Text
                    selectable
                    style={{
                      ...type.title3,
                      color: colors.label,

                      fontWeight: "700",
                      textAlign: "center",
                    }}
                  >
                    {t("teamDetailAddQueue")}
                  </Text>
                </View>

                <Section>
                  <View style={{ gap: 4, paddingHorizontal: 16, paddingVertical: 10 }}>
                    <Text style={{ ...type.footnote, color: colors.secondaryLabel }}>
                      {t("teamDetailSelectChallenge")}
                    </Text>
                  </View>
                </Section>

                {availableChallengesLoading ? (
                  <View style={{ paddingVertical: 24 }}>
                    <AppActivityIndicator size="small" color={colors.accent} />
                  </View>
                ) : availableChallenges.length > 0 ? (
                  <Section>
                    {availableChallenges.map((ch, index) => (
                      <View key={ch.id}>
                        {index > 0 ? <Separator /> : null}
                        <View
                          style={{
                            flexDirection: "row",
                            gap: 12,
                            minHeight: 44,
                            alignItems: "center",
                            paddingHorizontal: 16,
                            paddingVertical: 10,
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text
                              numberOfLines={accessibilityText ? undefined : 1}
                              style={{ ...type.body, color: colors.label }}
                            >
                              {ch.title}
                            </Text>
                          </View>
                          {enrolling === ch.id ? (
                            <AppActivityIndicator size="small" color={colors.accent} />
                          ) : (
                            <PressableFeedback
                              feedback="opacity"
                              accessibilityRole="button"
                              accessibilityLabel={t("teamDetailAddQueue")}
                              disabled={enrolling !== null}
                              onPress={() => void enrollChallenge(ch.id)}
                              hitSlop={8}
                              style={{
                                minHeight: 44,
                                minWidth: 44,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Text style={{ ...type.body, color: colors.accent }}>{t("add")}</Text>
                            </PressableFeedback>
                          )}
                        </View>
                      </View>
                    ))}
                  </Section>
                ) : (
                  <Text
                    selectable
                    style={{
                      ...type.footnote,
                      color: colors.secondaryLabel,

                      paddingTop: 4,
                      textAlign: "center",
                    }}
                  >
                    {t("teamDetailAlreadyEnqueued")}
                  </Text>
                )}
              </ScrollView>

              <FloatingGlassButton
                top={16}
                side="left"
                icon="xmark"
                accessibilityLabel={t("cancel")}
                onPress={closeAddChallenge}
              />
            </AdaptiveFrame>
          </SheetModal>
        ) : null}
      </ScrollView>
    </>
  );
}

function memberDisplayName(member: TeamMember): string {
  return [member.name, member.surname].filter(Boolean).join(" ") || member.email;
}

function memberCandidateName(candidate: MemberCandidate): string {
  return [candidate.name, candidate.surname].filter(Boolean).join(" ") || candidate.email;
}

function DeleteMemberRevealAction({
  progress,
  label,
  onPress,
}: {
  progress: SharedValue<number>;
  label: string;
  onPress: () => void;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: interpolate(progress.value, [0, 1], [0.9, 1]) }],
    opacity: interpolate(progress.value, [0, 0.1, 1], [0, 0.5, 1]),
  }));
  return (
    <Animated.View
      style={[
        {
          alignItems: "center",
          backgroundColor: colors.destructive,
          borderBottomLeftRadius: radius.container,
          borderTopLeftRadius: radius.container,
          justifyContent: "center",
          minWidth: 140,
        },
        animatedStyle,
      ]}
    >
      <PressableFeedback
        feedback="opacity"
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: 6,
          height: "100%",
          justifyContent: "center",
          paddingHorizontal: 18,
        }}
      >
        <SymbolView name="trash.fill" tintColor="white" size={16} accessible={false} />
        <Text style={{ ...type.compact, color: "white", fontWeight: "700" }}>{label}</Text>
      </PressableFeedback>
    </Animated.View>
  );
}

function SwipeableMemberRow({
  enabled,
  actionLabel,
  onAction,
  children,
}: {
  enabled: boolean;
  actionLabel: string;
  onAction: () => void;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <Swipeable
      enabled
      rightThreshold={40}
      renderRightActions={(progress) => (
        <DeleteMemberRevealAction progress={progress} label={actionLabel} onPress={onAction} />
      )}
    >
      {children}
    </Swipeable>
  );
}

function queueStatusLabel(status: string, t: ReturnType<typeof useLocale>["t"]): string {
  switch (status) {
    case "called":
      return t("queueStatusCalled");
    case "in_room":
      return t("queueStatusInRoom");
    case "presenting":
      return t("queueStatusPresenting");
    case "completed":
      return t("queueStatusCompleted");
    case "disqualified":
      return t("queueStatusDisqualified");
    default:
      return t("queueStatusWaiting");
  }
}

function formatEta(minutes: number, anyMoment: string): string {
  if (minutes <= 0) return anyMoment;
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `~${hours}h ${remainder}m` : `~${hours}h`;
}

function historyActionLabel(row: HistoryRow, t: ReturnType<typeof useLocale>["t"]): string {
  return t("teamDetailHistoryTransition", {
    from: queueStatusLabel(row.previous_status, t),
    to: queueStatusLabel(row.new_status, t),
  });
}

function statusTone(status: string): "neutral" | "accent" | "success" | "warning" | "destructive" {
  if (status === "called") return "success";
  if (status === "waiting") return "accent";
  if (status === "disqualified") return "destructive";
  if (status === "completed") return "neutral";
  return "warning";
}

function QueueTabBar({
  challenges,
  selectedIndex,
  onSelect,
  canEdit,
  onAdd,
  t,
  scrollRef,
}: {
  challenges: RepoChallenge[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  canEdit: boolean;
  onAdd: () => void;
  t: ReturnType<typeof useLocale>["t"];
  scrollRef: React.RefObject<ScrollView | null>;
}) {
  const accessibilityText = isAccessibilityTextSize(useWindowDimensions().fontScale);
  return (
    <View style={{ borderBottomWidth: 0.5, borderBottomColor: colors.separator }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 4 }}
      >
        {challenges.map((qc, index) => {
          const selected = index === selectedIndex;
          return (
            <PressableFeedback
              feedback="opacity"
              key={`${qc.id}-${qc.room_id ?? "none"}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={qc.title}
              onPress={() => onSelect(index)}
              style={{
                alignItems: "center",
                borderBottomWidth: 2,
                borderBottomColor: selected ? colors.accent : "transparent",
                gap: 2,
                paddingHorizontal: 14,
                paddingVertical: 10,
              }}
            >
              <Text
                numberOfLines={accessibilityText ? undefined : 1}
                style={{
                  ...type.subhead,
                  color: selected ? colors.accent : colors.secondaryLabel,

                  fontWeight: selected ? "600" : "400",
                }}
              >
                {qc.title}
              </Text>
              {qc.room_name ? (
                <Text numberOfLines={1} style={{ ...type.caption, color: colors.secondaryLabel }}>
                  {qc.room_name}
                </Text>
              ) : null}
            </PressableFeedback>
          );
        })}
        {canEdit ? (
          <PressableFeedback
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel={t("teamDetailAddQueue")}
            onPress={onAdd}
            style={{
              alignItems: "center",
              borderBottomWidth: 2,
              borderBottomColor: "transparent",
              justifyContent: "center",
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <SymbolView name="plus" tintColor={colors.tertiaryLabel} size={15} accessible={false} />
          </PressableFeedback>
        ) : null}
      </ScrollView>
    </View>
  );
}

function QueueDetailView({
  queue,
  history,
  canEdit,
  onRemove,
  removing,
  t,
}: {
  queue: RepoChallenge;
  history: HistoryRow[] | null;
  canEdit: boolean;
  onRemove: (qc: RepoChallenge) => void;
  removing: number | null;
  t: ReturnType<typeof useLocale>["t"];
}) {
  return (
    <>
      <Section>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingVertical: 14,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.footnote, color: colors.secondaryLabel }}>
              {t("teamDetailChallenge")}
            </Text>
            <Text style={{ ...type.body, color: colors.label, fontWeight: "600", marginTop: 2 }}>
              {queue.title}
            </Text>
          </View>
          <StatusPill tone={statusTone(queue.status)}>
            {queueStatusLabel(queue.status, t)}
          </StatusPill>
        </View>

        {queue.room_name ? (
          <>
            <Separator inset={16} />
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 16,
                paddingVertical: 12,
              }}
            >
              <SymbolView
                name="door.left.hand.closed"
                tintColor={colors.tertiaryLabel}
                size={16}
                accessible={false}
              />
              <Text style={{ ...type.subhead, color: colors.secondaryLabel }}>
                {queue.room_name}
              </Text>
            </View>
          </>
        ) : null}

        {queue.position != null || queue.eta_minutes != null || queue.call_count > 0 ? (
          <>
            <Separator inset={16} />
            <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
              {queue.position != null ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <SymbolView
                    name="number.circle"
                    tintColor={colors.tertiaryLabel}
                    size={16}
                    accessible={false}
                  />
                  <Text style={{ ...type.subhead, color: colors.secondaryLabel, flex: 1 }}>
                    {t("queuePositionLabel")}
                  </Text>
                  <Text style={{ ...type.body, color: colors.label, fontWeight: "600" }}>
                    {queue.position}
                  </Text>
                </View>
              ) : null}
              {queue.eta_minutes != null ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <SymbolView
                    name="hourglass"
                    tintColor={colors.tertiaryLabel}
                    size={16}
                    accessible={false}
                  />
                  <Text style={{ ...type.subhead, color: colors.secondaryLabel, flex: 1 }}>
                    {t("queueWaitLabel")}
                  </Text>
                  <Text style={{ ...type.body, color: colors.label, fontWeight: "600" }}>
                    {formatEta(queue.eta_minutes, t("queueAnyMoment"))}
                  </Text>
                </View>
              ) : null}
              {queue.call_count > 0 ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <SymbolView
                    name="bell.badge"
                    tintColor={colors.tertiaryLabel}
                    size={16}
                    accessible={false}
                  />
                  <Text style={{ ...type.subhead, color: colors.secondaryLabel, flex: 1 }}>
                    {t("teamDetailCallCount")}
                  </Text>
                  <Text style={{ ...type.body, color: colors.label, fontWeight: "600" }}>
                    {queue.call_count}
                  </Text>
                </View>
              ) : null}
            </View>
          </>
        ) : null}

        {canEdit ? (
          <>
            <Separator inset={16} />
            <PressableFeedback
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel={t("teamDetailRemoveFromQueue")}
              disabled={removing === queue.id}
              onPress={() => onRemove(queue)}
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: 8,
                justifyContent: "center",
                minHeight: 44,
                paddingHorizontal: 16,
                paddingVertical: 12,
              }}
            >
              {removing === queue.id ? (
                <AppActivityIndicator size="small" color={colors.destructive} />
              ) : (
                <SymbolView
                  name="trash"
                  tintColor={colors.destructive}
                  size={16}
                  accessible={false}
                />
              )}
              <Text style={{ ...type.subhead, color: colors.destructive, fontWeight: "600" }}>
                {t("teamDetailRemoveFromQueue")}
              </Text>
            </PressableFeedback>
          </>
        ) : null}
      </Section>

      {history && history.length > 0 ? (
        <Section title={t("teamDetailHistory")}>
          {history
            .slice()
            .reverse()
            .slice(0, 8)
            .map((row, index) => (
              <View key={row.id}>
                {index > 0 ? <Separator /> : null}
                <View style={{ gap: 2, paddingHorizontal: 16, paddingVertical: 10 }}>
                  <Text style={{ ...type.subhead, color: colors.label, fontWeight: "600" }}>
                    {historyActionLabel(row, t)}
                  </Text>
                  <Text style={{ ...type.footnote, color: colors.secondaryLabel }}>
                    {[row.actor_name, row.actor_surname].filter(Boolean).join(" ") || "—"} ·{" "}
                    {new Date(row.created_at).toLocaleString()}
                  </Text>
                  {row.reason ? (
                    <Text style={{ ...type.footnote, color: colors.secondaryLabel }}>
                      {row.reason}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
        </Section>
      ) : null}
    </>
  );
}
