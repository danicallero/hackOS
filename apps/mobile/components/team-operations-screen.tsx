import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Linking, Pressable, ScrollView, Text, useColorScheme, View } from "react-native";
import { EmptyState, InfoRow, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { isPadIdiom } from "@/lib/tabs";
import { colors } from "@/theme/colors";

interface TeamMember {
  userId: number | null;
  email: string;
  name: string | null;
  surname: string | null;
}

interface TeamEntry {
  id: number;
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
  const router = useRouter();
  const { t } = useLocale();
  const [entry, setEntry] = useState<TeamEntry | null>(null);
  const [room, setRoom] = useState<RoomView["room"] | null>(null);
  const [challenge, setChallenge] = useState<RoomView["challenge"]>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loadState, setLoadState] = useState<TeamLoadState>("loading");

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

  useLayoutEffect(() => {
    headerNavigation.setOptions({
      title: entry ? teamName : "",
      headerLargeTitle: true,
      headerLeft: () => (
        <Pressable
          accessibilityLabel={t("back")}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
        >
          <SymbolView name="chevron.left" tintColor={colors.accent} size={20} weight="semibold" />
        </Pressable>
      ),
      headerRight: entry
        ? () => (
            <Text style={{ color: colors.secondaryLabel, fontSize: 15, fontWeight: "600" }}>
              {queueStatusLabel(entry.status, t)}
            </Text>
          )
        : undefined,
    });
  }, [headerNavigation, teamName, entry, router, t]);

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

      {members.length ? (
        <Section title={t("teamDetailMembers")}>
          {members.map((member, index) => (
            <View key={member.userId ?? member.email}>
              {index > 0 ? <Separator /> : null}
              <View style={{ gap: 2, paddingHorizontal: 16, paddingVertical: 10 }}>
                <Text style={{ color: colors.label, fontSize: 16, fontWeight: "600" }}>
                  {[member.name, member.surname].filter(Boolean).join(" ") || member.email}
                </Text>
                <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{member.email}</Text>
              </View>
            </View>
          ))}
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
