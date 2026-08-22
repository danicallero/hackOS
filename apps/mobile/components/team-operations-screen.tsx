import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { interpolate, type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  EmptyState,
  FloatingGlassButton,
  InfoRow,
  Section,
  Separator,
  StatusPill,
} from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { useMeContext } from "@/lib/me-context";
import { isPadIdiom } from "@/lib/tabs";
import { colors } from "@/theme/colors";

interface TeamMember {
  userId: number | null;
  email: string;
  name: string | null;
  surname: string | null;
  source?: "devpost" | "manual";
  matchType?: "primary_email" | "secondary_email" | "manual" | "unmatched";
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
  repo_devpost_url?: string | null;
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
  id: number;
  title: string;
  status: string;
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

type TeamLoadState = "loading" | "ready" | "missing" | "error";

/** H29/H31 operator team detail: the participant's own queue card, with the extra context an operator needs. */
export function TeamOperationsScreen() {
  useColorScheme();
  const { entryId, roomId } = useLocalSearchParams<{ entryId: string; roomId: string }>();
  const headerNavigation = useNavigation(isPadIdiom() ? "/(tabs)/others" : undefined);
  const { t, language } = useLocale();
  const { me } = useMeContext();
  const insets = useSafeAreaInsets();
  // Android has no page-sheet presentation: these modals are full-screen, so
  // their chrome has to clear the status bar itself.
  const sheetTopInset = process.env.EXPO_OS === "android" ? insets.top : 0;
  const [entry, setEntry] = useState<TeamEntry | null>(null);
  const [room, setRoom] = useState<RoomView["room"] | null>(null);
  const [repoChallenges, setRepoChallenges] = useState<RepoChallenge[]>([]);
  const [selectedQueueIndex, setSelectedQueueIndex] = useState(0);
  const [roomViews, setRoomViews] = useState<Map<number, RoomView>>(new Map());
  const roomViewsRef = useRef(roomViews);
  roomViewsRef.current = roomViews;
  const [selectedEntryHistory, setSelectedEntryHistory] = useState<HistoryRow[] | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadState, setLoadState] = useState<TeamLoadState>("loading");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberCandidates, setMemberCandidates] = useState<MemberCandidate[]>([]);
  const [memberCandidatesLoading, setMemberCandidatesLoading] = useState(false);
  const [memberCandidatesError, setMemberCandidatesError] = useState<Error | null>(null);
  const [memberSearched, setMemberSearched] = useState(false);
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
  const canLinkProject =
    me?.capabilities.includes(CAPABILITIES.ADMIN_ALL) ||
    me?.capabilities.includes(CAPABILITIES.PROJECTS_IMPORT) ||
    false;
  const [linkTarget, setLinkTarget] = useState<TeamMember | null>(null);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkCandidates, setLinkCandidates] = useState<MemberCandidate[]>([]);
  const [linkCandidatesLoading, setLinkCandidatesLoading] = useState(false);
  const [linkCandidatesError, setLinkCandidatesError] = useState<Error | null>(null);
  const [linkSearched, setLinkSearched] = useState(false);
  const [linkMutation, setLinkMutation] = useState(false);
  const [linkError, setLinkError] = useState<Error | null>(null);
  const [linkSuccess, setLinkSuccess] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoadState((current) => (current === "ready" ? current : "loading"));
    try {
      const [view, historyRows] = await Promise.all([
        apiFetch<RoomView>(`/api/queue/rooms/${roomId}/view`),
        apiFetch<HistoryRow[]>(`/api/queue/entries/${entryId}/history`),
      ]);
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
      setRoomViews(new Map([[Number(roomId), view]]));
      setSelectedEntryHistory(historyRows);
      try {
        const challenges = await apiFetch<RepoChallenge[]>(
          `/api/queue/repos/${found.repo_id}/challenges`,
        );
        setRepoChallenges(challenges);
        const targetChallengeId = Number(found.challenge_id);
        const idx = challenges.findIndex((qc) => Number(qc.id) === targetChallengeId);
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

  useEffect(() => {
    if (loadState !== "ready") return;
    let cancelled = false;
    const prefetchAll = async () => {
      try {
        const rooms = await apiFetch<Array<{ id: number }>>("/api/queue/rooms");
        if (cancelled) return;
        const currentViews = roomViewsRef.current;
        const uncachedIds = rooms.map((r) => Number(r.id)).filter((id) => !currentViews.has(id));
        if (uncachedIds.length === 0) return;
        const views = await Promise.all(
          uncachedIds.map((id) => apiFetch<RoomView>(`/api/queue/rooms/${id}/view`)),
        );
        if (cancelled) return;
        setRoomViews((prev) => {
          const next = new Map(prev);
          for (let i = 0; i < uncachedIds.length; i++) {
            next.set(uncachedIds[i], views[i]);
          }
          return next;
        });
      } catch {
        /* tab switching will fall back to individual fetch */
      }
    };
    void prefetchAll();
    return () => {
      cancelled = true;
    };
  }, [loadState]);

  const teamName = entry?.repo_name ?? t("queueOpsUnnamedTeam");

  const findMemberCandidates = useCallback(
    async (rawQuery = memberQuery) => {
      const query = rawQuery.trim();
      if (!query) {
        setMemberCandidates([]);
        setMemberSearched(false);
        return;
      }
      setMemberCandidatesLoading(true);
      setMemberCandidatesError(null);
      try {
        const result = await apiFetch<{ users: MemberCandidate[] }>(
          `/api/projects/member-candidates?q=${encodeURIComponent(query)}`,
        );
        setMemberCandidates(result.users);
        setMemberSearched(true);
      } catch (cause) {
        setMemberCandidatesError(
          cause instanceof Error ? cause : new Error(t("teamDetailMemberSearchError")),
        );
      } finally {
        setMemberCandidatesLoading(false);
      }
    },
    [memberQuery, t],
  );

  useEffect(() => {
    const query = memberQuery.trim();
    if (query.length < 2) {
      setMemberCandidates([]);
      setMemberSearched(false);
      return;
    }
    const handle = setTimeout(() => {
      void findMemberCandidates(query);
    }, 250);
    return () => clearTimeout(handle);
  }, [findMemberCandidates, memberQuery]);

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
            "Idempotency-Key": createIdempotencyKey(),
          },
          body: JSON.stringify({ userId }),
        });
        setMemberQuery("");
        setMemberCandidates([]);
        setMemberSearched(false);
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

  const deleteMember = useCallback(
    async (member: TeamMember) => {
      if (!entry || !member.source) return;
      setMemberMutation(member.email);
      setMemberMutationError(null);
      try {
        if (member.source === "devpost") {
          await apiFetch(
            `/api/repos/${entry.repo_id}/devpost-participants/${encodeURIComponent(member.email)}`,
            { method: "DELETE" },
          );
        } else if (member.userId !== null) {
          await apiFetch(`/api/repos/${entry.repo_id}/members/${member.userId}`, {
            method: "DELETE",
          });
        }
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
      if (!member.source) return;
      const secondaryLinked = isSecondaryLinkedMember(member);
      const name = memberDisplayName(member);
      const description = secondaryLinked
        ? t("teamDetailUnlinkSecondaryConfirm", { name })
        : member.source === "devpost"
          ? t("teamDetailRemoveImportedMemberConfirm", { name })
          : t("teamDetailRemoveMemberConfirm", { name });
      const actionLabel = secondaryLinked
        ? t("teamDetailUnlinkSecondary")
        : t("teamDetailRemoveMember");
      Alert.alert(actionLabel, description, [
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

  const openLinkModal = useCallback((member: TeamMember) => {
    setLinkTarget(member);
    setLinkQuery("");
    setLinkCandidates([]);
    setLinkSearched(false);
    setLinkError(null);
    setLinkSuccess(false);
  }, []);

  const closeLinkModal = useCallback(() => {
    setLinkTarget(null);
    setLinkQuery("");
    setLinkCandidates([]);
    setLinkSearched(false);
    setLinkError(null);
    setLinkSuccess(false);
  }, []);

  const searchLinkCandidates = useCallback(
    async (rawQuery = linkQuery) => {
      const query = rawQuery.trim();
      if (!query) {
        setLinkCandidates([]);
        setLinkSearched(false);
        return;
      }
      setLinkCandidatesLoading(true);
      setLinkCandidatesError(null);
      try {
        const result = await apiFetch<{ users: MemberCandidate[] }>(
          `/api/projects/member-candidates?q=${encodeURIComponent(query)}`,
        );
        setLinkCandidates(result.users);
        setLinkSearched(true);
      } catch (cause) {
        setLinkCandidatesError(
          cause instanceof Error ? cause : new Error(t("teamDetailMemberSearchError")),
        );
      } finally {
        setLinkCandidatesLoading(false);
      }
    },
    [linkQuery, t],
  );

  useEffect(() => {
    const query = linkQuery.trim();
    if (query.length < 2 || !linkTarget) {
      setLinkCandidates([]);
      setLinkSearched(false);
      return;
    }
    const handle = setTimeout(() => {
      void searchLinkCandidates(query);
    }, 250);
    return () => clearTimeout(handle);
  }, [searchLinkCandidates, linkQuery, linkTarget]);

  const linkParticipant = useCallback(
    async (candidate: MemberCandidate) => {
      if (!linkTarget || !entry) return;
      setLinkMutation(true);
      setLinkError(null);
      try {
        await apiFetch("/api/devpost/imports/link-secondary", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": createIdempotencyKey(),
          },
          body: JSON.stringify({
            repoId: entry.repo_id,
            email: linkTarget.email,
            userId: candidate.id,
          }),
        });
        setLinkSuccess(true);
        await load();
      } catch (cause) {
        setLinkError(cause instanceof Error ? cause : new Error(t("teamDetailLinkError")));
      } finally {
        setLinkMutation(false);
      }
    },
    [linkTarget, entry, load, t],
  );

  const selectedQueue = repoChallenges[selectedQueueIndex] ?? null;

  const selectedEntry = (() => {
    if (!selectedQueue) return null;
    const targetId = Number(selectedQueue.id);
    if (entry && Number(entry.challenge_id) === targetId) return entry;
    for (const [, view] of roomViews) {
      if (view.active && Number(view.active.challenge_id) === targetId) return view.active;
      const found = [...view.called, ...view.next].find(
        (item) => item != null && Number(item.challenge_id) === targetId,
      );
      if (found) return found;
    }
    return null;
  })();

  const fetchTabData = useCallback(
    async (qc: RepoChallenge) => {
      const targetId = Number(qc.id);
      const findEntry = (view: RoomView) => {
        if (view.active && Number(view.active.challenge_id) === targetId) return view.active;
        return (
          [...view.called, ...view.next].find(
            (item) => item != null && Number(item.challenge_id) === targetId,
          ) ?? null
        );
      };
      const currentViews = roomViewsRef.current;
      for (const [, view] of currentViews) {
        const found = findEntry(view);
        if (found) {
          try {
            const rows = await apiFetch<HistoryRow[]>(`/api/queue/entries/${found.id}/history`);
            setSelectedEntryHistory(rows);
          } catch {
            setSelectedEntryHistory([]);
          }
          return;
        }
      }
      const roomIdKey = qc.room_id ?? qc.judging_rooms[0]?.id ?? Number(roomId);
      if (!roomIdKey) {
        setSelectedEntryHistory(null);
        return;
      }
      setSelectedEntryHistory(null);
      setTabLoading(true);
      try {
        const view = await apiFetch<RoomView>(`/api/queue/rooms/${roomIdKey}/view`);
        setRoomViews((prev) => new Map(prev).set(Number(roomIdKey), view));
        const found = findEntry(view);
        if (found) {
          try {
            const rows = await apiFetch<HistoryRow[]>(`/api/queue/entries/${found.id}/history`);
            setSelectedEntryHistory(rows);
          } catch {
            setSelectedEntryHistory([]);
          }
        } else {
          setSelectedEntryHistory(null);
        }
      } catch {
        setSelectedEntryHistory(null);
      } finally {
        setTabLoading(false);
      }
    },
    [roomId],
  );

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
            "Idempotency-Key": createIdempotencyKey(),
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
      Alert.alert(
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
    { icon: "trophy" as const, label: t("teamDetailDevpost"), url: entry.repo_devpost_url },
    { icon: "play.rectangle" as const, label: t("teamDetailDemo"), url: entry.repo_demo_url },
  ].filter((link) => Boolean(link.url));

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ gap: 22, padding: 16, paddingBottom: 40 }}
      style={{ backgroundColor: colors.background }}
    >
      {entry.status === "called" ? (
        <View
          accessibilityRole="alert"
          style={{
            backgroundColor: colors.successSurface,
            borderCurve: "continuous",
            borderRadius: 12,
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
              style={{ color: colors.onSuccessSurface, flex: 1, fontSize: 17, fontWeight: "800" }}
            >
              {t("teamDetailAtDoor", { room: room.name })}
            </Text>
          </View>
          {room.location ? (
            <Text style={{ color: colors.onSuccessSurface, fontSize: 14, paddingLeft: 30 }}>
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
              enabled={canEditProject && Boolean(member.source)}
              actionLabel={
                isSecondaryLinkedMember(member)
                  ? t("teamDetailUnlinkSecondary")
                  : t("teamDetailRemoveMember")
              }
              onAction={() => removeMember(member)}
            >
              <View
                accessible
                accessibilityLabel={`${memberDisplayName(member)}, ${member.email}, ${memberLinkLabel(member, t)}`}
                style={{
                  flexDirection: "row",
                  gap: 12,
                  minHeight: 44,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                }}
              >
                <View style={{ flex: 1, justifyContent: "center" }}>
                  <Text selectable numberOfLines={1} style={{ color: colors.label, fontSize: 17 }}>
                    {memberDisplayName(member)}
                  </Text>
                  <Text
                    selectable
                    numberOfLines={1}
                    style={{ color: colors.secondaryLabel, fontSize: 15 }}
                  >
                    {member.email}
                  </Text>
                </View>
                {member.matchType === "unmatched" && canLinkProject ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("teamDetailLinkToAccount")}
                    onPress={() => openLinkModal(member)}
                    disabled={memberMutation !== null}
                    hitSlop={8}
                    style={({ pressed }) => ({
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: pressed ? 0.5 : 1,
                    })}
                  >
                    <Text style={{ color: colors.accent, fontSize: 15 }}>
                      {t("teamDetailLinkToAccount")}
                    </Text>
                  </Pressable>
                ) : (
                  <View style={{ alignItems: "center", justifyContent: "center" }}>
                    <StatusPill tone={memberLinkTone(member)}>
                      {memberLinkLabel(member, t)}
                    </StatusPill>
                  </View>
                )}
              </View>
            </SwipeableMemberRow>
          </View>
        ))}
        {canEditProject ? (
          <>
            {members.length ? <Separator /> : null}
            <View style={{ gap: 8, padding: 16 }}>
              <Text style={{ color: colors.label, fontSize: 15, fontWeight: "600" }}>
                {t("teamDetailAddMember")}
              </Text>
              <Text style={{ color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 }}>
                {t("teamDetailAddMemberHint")}
              </Text>
              <View
                style={{
                  alignItems: "center",
                  backgroundColor: colors.elevatedSurface,
                  borderCurve: "continuous",
                  borderRadius: 10,
                  flexDirection: "row",
                  gap: 8,
                  minHeight: 36,
                  paddingHorizontal: 8,
                }}
              >
                <Pressable
                  accessibilityLabel={t("teamDetailMemberSearch")}
                  accessibilityRole="button"
                  onPress={() => void findMemberCandidates()}
                  hitSlop={8}
                >
                  <SymbolView name="magnifyingglass" tintColor={colors.tertiaryLabel} size={15} />
                </Pressable>
                <TextInput
                  accessibilityLabel={t("teamDetailMemberSearch")}
                  editable={memberMutation === null && !memberCandidatesLoading}
                  onChangeText={(value) => {
                    setMemberQuery(value);
                    setMemberCandidates([]);
                    setMemberCandidatesError(null);
                    setMemberSearched(false);
                  }}
                  onSubmitEditing={() => void findMemberCandidates()}
                  placeholder={t("teamDetailMemberSearchPlaceholder")}
                  placeholderTextColor={colors.tertiaryLabel}
                  returnKeyType="search"
                  value={memberQuery}
                  style={{
                    color: colors.label,
                    flex: 1,
                    fontSize: 17,
                    minHeight: 36,
                  }}
                />
                {memberQuery.length > 0 ? (
                  <Pressable
                    accessibilityLabel={t("cancel")}
                    onPress={() => {
                      setMemberQuery("");
                      setMemberCandidates([]);
                      setMemberCandidatesError(null);
                      setMemberSearched(false);
                    }}
                    hitSlop={8}
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
              {memberCandidatesError ? (
                <RequestFeedback
                  error={memberCandidatesError}
                  message={memberCandidatesError.message}
                />
              ) : null}
              {memberMutationError ? (
                <RequestFeedback
                  error={memberMutationError}
                  message={memberMutationError.message}
                />
              ) : null}
              {memberCandidates.map((candidate) => (
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
                        numberOfLines={1}
                        style={{ color: colors.label, fontSize: 17 }}
                      >
                        {memberCandidateName(candidate)}
                      </Text>
                      <Text
                        selectable
                        numberOfLines={1}
                        style={{ color: colors.secondaryLabel, fontSize: 15 }}
                      >
                        {candidate.email}
                      </Text>
                    </View>
                    {memberMutation === `add:${candidate.id}` ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("teamDetailAddCandidate", {
                          name: memberCandidateName(candidate),
                        })}
                        disabled={memberMutation !== null}
                        onPress={() => void addMember(candidate.id)}
                        hitSlop={8}
                        style={({ pressed }) => ({
                          minHeight: 44,
                          minWidth: 44,
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: pressed ? 0.5 : 1,
                        })}
                      >
                        <Text style={{ color: colors.accent, fontSize: 17 }}>{t("add")}</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ))}
              {!memberCandidatesLoading && memberSearched && memberCandidates.length === 0 ? (
                <Text
                  selectable
                  style={{
                    color: colors.secondaryLabel,
                    fontSize: 13,
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
              <Pressable
                accessibilityRole="link"
                onPress={() => void Linking.openURL(link.url!)}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <InfoRow
                  label={link.label}
                  value={link.url!}
                  icon={link.icon}
                  accessoryIcon="chevron.right"
                />
              </Pressable>
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
              entry={selectedEntry}
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

      {linkTarget ? (
        <Modal animationType="slide" onRequestClose={closeLinkModal} presentationStyle="pageSheet">
          <View style={{ backgroundColor: colors.background, flex: 1 }}>
            <ScrollView
              contentInsetAdjustmentBehavior="automatic"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                gap: 22,
                padding: 16,
                paddingBottom: Math.max(32, insets.bottom + 16),
                paddingTop: 16 + sheetTopInset,
              }}
            >
              <View style={{ justifyContent: "center", minHeight: 44, paddingHorizontal: 52 }}>
                <Text
                  selectable
                  style={{
                    color: colors.label,
                    fontSize: 20,
                    fontWeight: "700",
                    textAlign: "center",
                  }}
                >
                  {t("teamDetailLinkTitle")}
                </Text>
              </View>

              <Section>
                <View style={{ gap: 4, paddingHorizontal: 16, paddingVertical: 10 }}>
                  <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                    {t("teamDetailLinkHint")}
                  </Text>
                  <Text style={{ color: colors.label, fontSize: 17 }}>{linkTarget.email}</Text>
                </View>
              </Section>

              <Section>
                <View
                  accessible
                  accessibilityLabel={t("teamDetailLinkSearchPlaceholder")}
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    gap: 8,
                    minHeight: 44,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                  }}
                >
                  <SymbolView
                    name="magnifyingglass"
                    tintColor={colors.tertiaryLabel}
                    size={16}
                    accessible={false}
                  />
                  <TextInput
                    accessibilityLabel={t("teamDetailLinkSearchPlaceholder")}
                    editable={!linkMutation}
                    onChangeText={(value) => {
                      setLinkQuery(value);
                      setLinkCandidates([]);
                      setLinkCandidatesError(null);
                      setLinkSearched(false);
                      setLinkSuccess(false);
                    }}
                    onSubmitEditing={() => void searchLinkCandidates()}
                    placeholder={t("teamDetailLinkSearchPlaceholder")}
                    placeholderTextColor={colors.tertiaryLabel}
                    returnKeyType="search"
                    value={linkQuery}
                    style={{
                      color: colors.label,
                      flex: 1,
                      fontSize: 17,
                      minHeight: 44,
                    }}
                  />
                  {linkQuery.length > 0 ? (
                    <Pressable
                      accessibilityLabel={t("cancel")}
                      onPress={() => {
                        setLinkQuery("");
                        setLinkCandidates([]);
                        setLinkCandidatesError(null);
                        setLinkSearched(false);
                        setLinkSuccess(false);
                      }}
                      hitSlop={8}
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
              </Section>

              {linkCandidatesError ? (
                <RequestFeedback
                  error={linkCandidatesError}
                  message={linkCandidatesError.message}
                />
              ) : null}
              {linkError ? <RequestFeedback error={linkError} message={linkError.message} /> : null}
              {linkSuccess ? (
                <View
                  style={{
                    backgroundColor: colors.successSurface,
                    borderCurve: "continuous",
                    borderRadius: 14,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                  }}
                >
                  <Text style={{ color: colors.onSuccessSurface, fontSize: 15 }}>
                    {t("teamDetailLinkSuccess")}
                  </Text>
                </View>
              ) : null}

              {linkCandidates.length > 0 ? (
                <Section>
                  {linkCandidates.map((candidate, index) => (
                    <View key={candidate.id}>
                      {index > 0 ? <Separator /> : null}
                      <Pressable
                        accessibilityRole="button"
                        disabled={linkMutation}
                        onPress={() => void linkParticipant(candidate)}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          gap: 12,
                          minHeight: 44,
                          opacity: pressed ? 0.5 : 1,
                          paddingHorizontal: 16,
                          paddingVertical: 10,
                        })}
                      >
                        <View style={{ flex: 1 }}>
                          <Text numberOfLines={1} style={{ color: colors.label, fontSize: 17 }}>
                            {memberCandidateName(candidate)}
                          </Text>
                          <Text
                            numberOfLines={1}
                            style={{ color: colors.secondaryLabel, fontSize: 15 }}
                          >
                            {candidate.email}
                          </Text>
                        </View>
                        {linkMutation ? (
                          <ActivityIndicator size="small" color={colors.accent} />
                        ) : (
                          <SymbolView
                            name="plus.circle"
                            tintColor={colors.accent}
                            size={22}
                            accessible={false}
                          />
                        )}
                      </Pressable>
                    </View>
                  ))}
                </Section>
              ) : null}

              {!linkCandidatesLoading &&
              linkSearched &&
              linkCandidates.length === 0 &&
              !linkSuccess ? (
                <Text
                  selectable
                  style={{
                    color: colors.secondaryLabel,
                    fontSize: 13,
                    paddingTop: 4,
                    textAlign: "center",
                  }}
                >
                  {t("teamDetailNoMemberCandidates")}
                </Text>
              ) : null}
            </ScrollView>

            <FloatingGlassButton
              top={16 + sheetTopInset}
              side="left"
              icon="xmark"
              accessibilityLabel={t("cancel")}
              onPress={closeLinkModal}
            />
          </View>
        </Modal>
      ) : null}

      {showAddChallenge ? (
        <Modal
          animationType="slide"
          onRequestClose={closeAddChallenge}
          presentationStyle="pageSheet"
        >
          <View style={{ backgroundColor: colors.background, flex: 1 }}>
            <ScrollView
              contentInsetAdjustmentBehavior="automatic"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                gap: 22,
                padding: 16,
                paddingBottom: Math.max(32, insets.bottom + 16),
                paddingTop: 16 + sheetTopInset,
              }}
            >
              <View style={{ justifyContent: "center", minHeight: 44, paddingHorizontal: 52 }}>
                <Text
                  selectable
                  style={{
                    color: colors.label,
                    fontSize: 20,
                    fontWeight: "700",
                    textAlign: "center",
                  }}
                >
                  {t("teamDetailAddQueue")}
                </Text>
              </View>

              <Section>
                <View style={{ gap: 4, paddingHorizontal: 16, paddingVertical: 10 }}>
                  <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                    {t("teamDetailSelectChallenge")}
                  </Text>
                </View>
              </Section>

              {availableChallengesLoading ? (
                <View style={{ paddingVertical: 24 }}>
                  <ActivityIndicator size="small" color={colors.accent} />
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
                          <Text numberOfLines={1} style={{ color: colors.label, fontSize: 17 }}>
                            {ch.title}
                          </Text>
                        </View>
                        {enrolling === ch.id ? (
                          <ActivityIndicator size="small" color={colors.accent} />
                        ) : (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("teamDetailAddQueue")}
                            disabled={enrolling !== null}
                            onPress={() => void enrollChallenge(ch.id)}
                            hitSlop={8}
                            style={({ pressed }) => ({
                              minHeight: 44,
                              minWidth: 44,
                              alignItems: "center",
                              justifyContent: "center",
                              opacity: pressed ? 0.5 : 1,
                            })}
                          >
                            <Text style={{ color: colors.accent, fontSize: 17 }}>{t("add")}</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  ))}
                </Section>
              ) : (
                <Text
                  selectable
                  style={{
                    color: colors.secondaryLabel,
                    fontSize: 13,
                    paddingTop: 4,
                    textAlign: "center",
                  }}
                >
                  {t("teamDetailAlreadyEnqueued")}
                </Text>
              )}
            </ScrollView>

            <FloatingGlassButton
              top={16 + sheetTopInset}
              side="left"
              icon="xmark"
              accessibilityLabel={t("cancel")}
              onPress={closeAddChallenge}
            />
          </View>
        </Modal>
      ) : null}
    </ScrollView>
  );
}

function memberDisplayName(member: TeamMember): string {
  return [member.name, member.surname].filter(Boolean).join(" ") || member.email;
}

function memberCandidateName(candidate: MemberCandidate): string {
  return [candidate.name, candidate.surname].filter(Boolean).join(" ") || candidate.email;
}

function memberLinkLabel(member: TeamMember, t: ReturnType<typeof useLocale>["t"]): string {
  if (member.source === "manual") return t("teamDetailMemberAddedByStaff");
  switch (member.matchType) {
    case "primary_email":
      return t("teamDetailMemberPrimaryEmail");
    case "secondary_email":
      return t("teamDetailMemberSecondaryEmail");
    case "manual":
      return t("teamDetailMemberStaffLinked");
    default:
      return t("teamDetailMemberUnmatched");
  }
}

function isSecondaryLinkedMember(member: TeamMember): boolean {
  return member.source === "devpost" && member.matchType === "secondary_email";
}

function memberLinkTone(
  member: TeamMember,
): "neutral" | "accent" | "success" | "warning" | "destructive" {
  if (member.source === "manual") return "accent";
  switch (member.matchType) {
    case "primary_email":
      return "success";
    case "secondary_email":
      return "warning";
    case "manual":
      return "accent";
    default:
      return "neutral";
  }
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
          borderBottomLeftRadius: 14,
          borderTopLeftRadius: 14,
          justifyContent: "center",
          minWidth: 140,
        },
        animatedStyle,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => ({
          alignItems: "center",
          flexDirection: "row",
          gap: 6,
          height: "100%",
          justifyContent: "center",
          opacity: pressed ? 0.75 : 1,
          paddingHorizontal: 18,
        })}
      >
        <SymbolView name="trash.fill" tintColor="white" size={16} accessible={false} />
        <Text style={{ color: "white", fontSize: 14, fontWeight: "700" }}>{label}</Text>
      </Pressable>
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
            <Pressable
              key={`${qc.id}-${qc.room_id ?? "none"}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={qc.title}
              onPress={() => onSelect(index)}
              style={({ pressed }) => ({
                alignItems: "center",
                borderBottomWidth: 2,
                borderBottomColor: selected ? colors.accent : "transparent",
                gap: 2,
                opacity: pressed ? 0.7 : 1,
                paddingHorizontal: 14,
                paddingVertical: 10,
              })}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: selected ? colors.accent : colors.secondaryLabel,
                  fontSize: 15,
                  fontWeight: selected ? "600" : "400",
                }}
              >
                {qc.title}
              </Text>
              {qc.room_name ? (
                <Text numberOfLines={1} style={{ color: colors.tertiaryLabel, fontSize: 12 }}>
                  {qc.room_name}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("teamDetailAddQueue")}
            onPress={onAdd}
            style={({ pressed }) => ({
              alignItems: "center",
              borderBottomWidth: 2,
              borderBottomColor: "transparent",
              justifyContent: "center",
              opacity: pressed ? 0.7 : 1,
              paddingHorizontal: 12,
              paddingVertical: 10,
            })}
          >
            <SymbolView name="plus" tintColor={colors.tertiaryLabel} size={15} accessible={false} />
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function QueueDetailView({
  queue,
  entry,
  history,
  canEdit,
  onRemove,
  removing,
  t,
}: {
  queue: RepoChallenge;
  entry: TeamEntry | null;
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
            <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
              {t("teamDetailChallenge")}
            </Text>
            <Text style={{ color: colors.label, fontSize: 17, fontWeight: "600", marginTop: 2 }}>
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
              <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>{queue.room_name}</Text>
            </View>
          </>
        ) : null}

        <Separator inset={16} />
        <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
          {entry ? (
            <>
              {entry.position != null ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <SymbolView
                    name="number.circle"
                    tintColor={colors.tertiaryLabel}
                    size={16}
                    accessible={false}
                  />
                  <Text style={{ color: colors.secondaryLabel, fontSize: 15, flex: 1 }}>
                    {t("queuePositionLabel")}
                  </Text>
                  <Text style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>
                    {entry.position}
                  </Text>
                </View>
              ) : null}
              {entry.eta_minutes != null ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <SymbolView
                    name="hourglass"
                    tintColor={colors.tertiaryLabel}
                    size={16}
                    accessible={false}
                  />
                  <Text style={{ color: colors.secondaryLabel, fontSize: 15, flex: 1 }}>
                    {t("queueWaitLabel")}
                  </Text>
                  <Text style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>
                    {formatEta(entry.eta_minutes, t("queueAnyMoment"))}
                  </Text>
                </View>
              ) : null}
              {entry.call_count > 0 ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <SymbolView
                    name="bell.badge"
                    tintColor={colors.tertiaryLabel}
                    size={16}
                    accessible={false}
                  />
                  <Text style={{ color: colors.secondaryLabel, fontSize: 15, flex: 1 }}>
                    {t("teamDetailCallCount")}
                  </Text>
                  <Text style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>
                    {entry.call_count}
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <SymbolView
                name="questionmark.circle"
                tintColor={colors.tertiaryLabel}
                size={16}
                accessible={false}
              />
              <Text style={{ color: colors.tertiaryLabel, fontSize: 15 }}>{t("queueLoading")}</Text>
            </View>
          )}
        </View>

        {canEdit ? (
          <>
            <Separator inset={16} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("teamDetailRemoveFromQueue")}
              disabled={removing === queue.id}
              onPress={() => onRemove(queue)}
              style={({ pressed }) => ({
                alignItems: "center",
                flexDirection: "row",
                gap: 8,
                justifyContent: "center",
                minHeight: 44,
                opacity: pressed ? 0.6 : 1,
                paddingHorizontal: 16,
                paddingVertical: 12,
              })}
            >
              {removing === queue.id ? (
                <ActivityIndicator size="small" color={colors.destructive} />
              ) : (
                <SymbolView
                  name="trash"
                  tintColor={colors.destructive}
                  size={16}
                  accessible={false}
                />
              )}
              <Text style={{ color: colors.destructive, fontSize: 15, fontWeight: "600" }}>
                {t("teamDetailRemoveFromQueue")}
              </Text>
            </Pressable>
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
                  <Text style={{ color: colors.label, fontSize: 15, fontWeight: "600" }}>
                    {historyActionLabel(row, t)}
                  </Text>
                  <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                    {[row.actor_name, row.actor_surname].filter(Boolean).join(" ") || "—"} ·{" "}
                    {new Date(row.created_at).toLocaleString()}
                  </Text>
                  {row.reason ? (
                    <Text style={{ color: colors.tertiaryLabel, fontSize: 13 }}>{row.reason}</Text>
                  ) : null}
                </View>
              </View>
            ))}
        </Section>
      ) : null}
    </>
  );
}
