import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { interpolate, type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import {
  ActionButton,
  EmptyState,
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
  /** The route that owns removal: Devpost import vs a staff-added repo member. */
  source?: "devpost" | "manual";
  matchType?: "primary_email" | "secondary_email" | "manual" | "unmatched";
}

interface TeamEntry {
  id: number;
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
  const { t } = useLocale();
  const { me } = useMeContext();
  const [entry, setEntry] = useState<TeamEntry | null>(null);
  const [room, setRoom] = useState<RoomView["room"] | null>(null);
  const [challenge, setChallenge] = useState<RoomView["challenge"]>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loadState, setLoadState] = useState<TeamLoadState>("loading");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberCandidates, setMemberCandidates] = useState<MemberCandidate[]>([]);
  const [memberCandidatesLoading, setMemberCandidatesLoading] = useState(false);
  const [memberCandidatesError, setMemberCandidatesError] = useState<Error | null>(null);
  const [memberSearched, setMemberSearched] = useState(false);
  const [memberMutationError, setMemberMutationError] = useState<Error | null>(null);
  const [memberMutation, setMemberMutation] = useState<string | null>(null);
  const canEditProject =
    me?.capabilities.includes(CAPABILITIES.ADMIN_ALL) ||
    me?.capabilities.includes(CAPABILITIES.PROJECTS_EDIT) ||
    false;

  const load = useCallback(async () => {
    setError(null);
    setLoadState((current) => (current === "ready" ? current : "loading"));
    try {
      const [view, historyRows] = await Promise.all([
        apiFetch<RoomView>(`/api/queue/rooms/${roomId}/view`),
        apiFetch<HistoryRow[]>(`/api/queue/entries/${entryId}/history`),
      ]);
      const found = [view.active, ...view.called, ...view.next].find(
        (item) => item?.id === Number(entryId),
      );
      if (!found || !view.room) {
        setEntry(null);
        setRoom(null);
        setChallenge(view.challenge);
        setHistory(historyRows);
        setLoadState("missing");
        return;
      }
      setEntry(found ?? null);
      setRoom(view.room);
      setChallenge(view.challenge);
      setHistory(historyRows);
      setLoadState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(t("queueOpsNotifyError")));
      setLoadState("error");
    }
  }, [entryId, roomId, t]);

  useEffect(() => {
    void load();
  }, [load]);

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

  useLayoutEffect(() => {
    headerNavigation.setOptions({
      title: entry ? teamName : "",
      headerLargeTitle: true,
      headerBackVisible: true,
      headerLeft: undefined,
      headerRight: entry
        ? () => (
            <Text style={{ color: colors.secondaryLabel, fontSize: 15, fontWeight: "600" }}>
              {queueStatusLabel(entry.status, t)}
            </Text>
          )
        : undefined,
    });
  }, [headerNavigation, teamName, entry, t]);

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
              tintColor={colors.success}
              size={22}
              accessible={false}
            />
            <Text style={{ color: colors.success, flex: 1, fontSize: 17, fontWeight: "800" }}>
              {t("teamDetailAtDoor", { room: room.name })}
            </Text>
          </View>
          {room.location ? (
            <Text style={{ color: colors.success, fontSize: 14, paddingLeft: 30 }}>
              {room.location}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Section title={t("teamDetailQueue")}>
        <InfoRow label={t("teamDetailChallenge")} value={challenge?.title ?? "—"} icon="flag" />
        <Separator />
        <InfoRow label={t("teamDetailRoom")} value={room.name} icon="door.left.hand.closed" />
        {entry.position != null ? (
          <>
            <Separator />
            <InfoRow
              label={t("queuePositionLabel")}
              value={String(entry.position)}
              icon="number.circle"
            />
          </>
        ) : null}
        {entry.eta_minutes != null ? (
          <>
            <Separator />
            <InfoRow
              label={t("queueWaitLabel")}
              value={formatEta(entry.eta_minutes, t("queueAnyMoment"))}
              icon="hourglass"
            />
          </>
        ) : null}
        {entry.call_count > 0 ? (
          <>
            <Separator />
            <InfoRow
              label={t("teamDetailCallCount")}
              value={String(entry.call_count)}
              icon="bell.badge"
            />
          </>
        ) : null}
      </Section>

      {members.length || canEditProject ? (
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
                <View style={{ gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
                  <Text selectable style={{ color: colors.label, fontSize: 16, fontWeight: "600" }}>
                    {memberDisplayName(member)}
                  </Text>
                  <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                    {member.email}
                  </Text>
                  <StatusPill tone={memberLinkTone(member)}>
                    {memberLinkLabel(member, t)}
                  </StatusPill>
                  {canEditProject && member.source ? (
                    <Pressable
                      accessibilityLabel={
                        isSecondaryLinkedMember(member)
                          ? t("teamDetailUnlinkSecondary")
                          : t("teamDetailRemoveMember")
                      }
                      accessibilityRole="button"
                      accessibilityState={{ busy: memberMutation === member.email }}
                      disabled={memberMutation !== null}
                      onPress={() => removeMember(member)}
                      style={({ pressed }) => ({
                        alignSelf: "flex-start",
                        minHeight: 44,
                        justifyContent: "center",
                        opacity: memberMutation !== null ? 0.45 : pressed ? 0.6 : 1,
                      })}
                    >
                      <Text style={{ color: colors.destructive, fontSize: 15, fontWeight: "600" }}>
                        {isSecondaryLinkedMember(member)
                          ? t("teamDetailUnlinkSecondary")
                          : t("teamDetailRemoveMember")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </SwipeableMemberRow>
            </View>
          ))}
          {canEditProject ? (
            <>
              {members.length ? <Separator /> : null}
              <View style={{ gap: 10, padding: 16 }}>
                <Text selectable style={{ color: colors.label, fontSize: 16, fontWeight: "600" }}>
                  {t("teamDetailAddMember")}
                </Text>
                <Text
                  selectable
                  style={{ color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 }}
                >
                  {t("teamDetailAddMemberHint")}
                </Text>
                <Text
                  selectable
                  style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}
                >
                  {t("teamDetailMemberSearch")}
                </Text>
                <TextInput
                  accessibilityLabel={t("teamDetailMemberSearch")}
                  editable={memberMutation === null && !memberCandidatesLoading}
                  onChangeText={(value) => {
                    setMemberQuery(value);
                    setMemberCandidates([]);
                    setMemberCandidatesError(null);
                    setMemberSearched(false);
                  }}
                  placeholder={t("teamDetailMemberSearchPlaceholder")}
                  placeholderTextColor={colors.tertiaryLabel}
                  value={memberQuery}
                  style={{
                    backgroundColor: colors.elevatedSurface,
                    borderCurve: "continuous",
                    borderRadius: 10,
                    color: colors.label,
                    fontSize: 16,
                    minHeight: 44,
                    paddingHorizontal: 12,
                  }}
                />
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
                <ActionButton
                  busy={memberCandidatesLoading}
                  disabled={memberMutation !== null || memberQuery.trim().length < 2}
                  icon="magnifyingglass"
                  label={t("teamDetailMemberSearch")}
                  onPress={() => void findMemberCandidates()}
                />
                {memberQuery.trim().length === 1 ? (
                  <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                    {t("teamDetailMemberSearchMin")}
                  </Text>
                ) : null}
                {!memberCandidatesLoading && memberSearched && memberCandidates.length > 0 ? (
                  <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                    {t("teamDetailMemberCandidateCount", {
                      count: String(memberCandidates.length),
                    })}
                  </Text>
                ) : null}
                {memberCandidates.map((candidate) => (
                  <View key={candidate.id} style={{ gap: 4, paddingTop: 4 }}>
                    <Text
                      selectable
                      style={{ color: colors.label, fontSize: 15, fontWeight: "600" }}
                    >
                      {memberCandidateName(candidate)}
                    </Text>
                    <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                      {candidate.email}
                    </Text>
                    <ActionButton
                      busy={memberMutation === `add:${candidate.id}`}
                      disabled={memberMutation !== null}
                      icon="person.badge.plus"
                      label={t("teamDetailAddCandidate", { name: memberCandidateName(candidate) })}
                      onPress={() => void addMember(candidate.id)}
                    />
                  </View>
                ))}
                {!memberCandidatesLoading && memberSearched && memberCandidates.length === 0 ? (
                  <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                    {t("teamDetailNoMemberCandidates")}
                  </Text>
                ) : null}
              </View>
            </>
          ) : null}
        </Section>
      ) : null}

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

      {history?.length ? (
        <Section title={t("teamDetailHistory")}>
          {history
            .slice()
            .reverse()
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
                    <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{row.reason}</Text>
                  ) : null}
                </View>
              </View>
            ))}
        </Section>
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
