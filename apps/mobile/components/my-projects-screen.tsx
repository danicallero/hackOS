import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { GlassView, isRealLiquidGlassAvailable } from "@/components/glass-view";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { GlassButton, NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { ApiError, apiFetch } from "@/lib/api";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { subscribeToCategory } from "@/lib/notification-events";
import {
  formatEtaMinutes,
  type NativeProject,
  type ProjectInvite,
  type ProjectQueueEntry,
  queueBriefFor,
  settleProjectDrafts,
} from "@/lib/projects";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { useTrueTopScroll } from "@/lib/use-true-top-scroll";
import { colors } from "@/theme/colors";

const STATUS_KEY: Record<string, MessageKey> = {
  waiting: "queueStatusWaiting",
  called: "queueStatusCalled",
  in_room: "queueStatusInRoom",
  presenting: "queueStatusPresenting",
  completed: "queueStatusCompleted",
  disqualified: "queueStatusDisqualified",
};

/** H19-H21: every project the user belongs to, with its live queue brief. */
export function MyProjectsScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const navigation = useNavigation();
  const scrollRef = useRef<ScrollView>(null);
  const trueTop = useTrueTopScroll(scrollRef);
  const bottomInset = useRouterTabBarScrollBottomInset();
  const [projects, setProjects] = useState<NativeProject[] | null>(null);
  const [invites, setInvites] = useState<ProjectInvite[]>([]);
  const [queue, setQueue] = useState<ProjectQueueEntry[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const load = useCallback(async () => {
    // H20: an editor closed a moment ago may still be saving its draft or name.
    await settleProjectDrafts();
    const [mine, invitations, entries] = await Promise.allSettled([
      apiFetch<{ projects: NativeProject[]; canCreate: boolean }>("/api/me/projects"),
      apiFetch<{ invites: ProjectInvite[] }>("/api/me/projects/invites"),
      apiFetch<ProjectQueueEntry[]>("/api/queue/me"),
    ]);
    // A failed secondary read must not hide the participant's own projects.
    setInvites(invitations.status === "fulfilled" ? invitations.value.invites : []);
    setQueue(entries.status === "fulfilled" && Array.isArray(entries.value) ? entries.value : []);
    if (mine.status === "fulfilled") {
      setProjects(mine.value.projects);
      setCanCreate(mine.value.canCreate);
      setError(invitations.status === "rejected" ? (invitations.reason as Error) : null);
    } else {
      setProjects((current) => current ?? []);
      setCanCreate(false);
      setError(mine.reason as Error);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
      return subscribeToCategory("queue", () => void load());
    }, [load]),
  );
  const glassAvailable = isRealLiquidGlassAvailable();
  const openInvites = useCallback(() => router.push("/queue/invites"), [router]);
  const openGallery = useCallback(() => router.push("/projects/gallery"), [router]);
  const openQueue = useCallback(() => router.push("/projects/queue"), [router]);
  const openNew = useCallback(() => router.push("/queue/new"), [router]);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("projects"),
      headerShown: true,
      headerLargeTitle: true,
      headerLargeTitleShadowVisible: false,
      headerShadowVisible: false,
      // iOS 26 gets native glass toolbar circles below; elsewhere the same
      // actions are 44 pt circles in the header.
      headerRight: glassAvailable
        ? undefined
        : () => (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <CircleButton icon="list.number" label={t("projectQueue")} onPress={openQueue} />
              {canCreate ? (
                <CircleButton icon="plus" label={t("createProject")} onPress={openNew} />
              ) : null}
            </View>
          ),
    });
  }, [navigation, t, glassAvailable, canCreate, openNew, openQueue]);

  function briefLines(project: NativeProject) {
    return queueBriefFor(queue, project.id)
      .slice(0, 3)
      .map((entry) => {
        const status =
          entry.status === "waiting" && entry.position != null
            ? t("queuePosition", { n: String(entry.position) })
            : t(STATUS_KEY[entry.status] ?? "queueStatusWaiting");
        const eta = entry.status === "waiting" ? formatEtaMinutes(entry.etaMinutes, t) : null;
        return [entry.challengeTitle, status, eta].filter(Boolean).join(" · ");
      });
  }
  return (
    <>
      {glassAvailable ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            separateBackground
            icon="list.number"
            accessibilityLabel={t("projectQueue")}
            onPress={openQueue}
          />
          {canCreate ? (
            <Stack.Toolbar.Button
              separateBackground
              icon="plus"
              accessibilityLabel={t("createProject")}
              onPress={openNew}
            />
          ) : null}
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        ref={scrollRef}
        {...trueTop.scrollProps}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 24, padding: 16, paddingBottom: bottomInset + 24 }}
      >
        {error ? (
          <RequestFeedback
            error={error}
            onRetry={
              error instanceof ApiError && error.status === 403 ? undefined : () => void load()
            }
          />
        ) : null}
        <View style={{ flexDirection: "row", gap: 12 }}>
          {invites.length > 0 ? (
            <GlassPill
              icon="person.2.fill"
              label={t("projectInvitations")}
              value={String(invites.length)}
              accessibilityLabel={`${t("projectInvitations")}, ${invites.length}`}
              onPress={openInvites}
            />
          ) : null}
          <GlassPill icon="photo.on.rectangle" label={t("gallery")} onPress={openGallery} />
        </View>
        {projects === null && !error ? <RequestFeedback loading /> : null}
        {projects?.length === 0 && !error ? (
          <EmptyState
            icon="hammer"
            title={t("projectNoProjects")}
            description={!canCreate ? t("projectLocked") : undefined}
            action={
              canCreate ? (
                <View style={{ alignSelf: "stretch", marginTop: 12 }}>
                  <GlassButton
                    label={t("createProject")}
                    prominent
                    onPress={() => router.push("/queue/new")}
                  />
                </View>
              ) : undefined
            }
          />
        ) : null}
        {projects && projects.length > 0 ? (
          <Section>
            {projects.map((project, index) => (
              <View key={project.id}>
                {index > 0 ? <Separator /> : null}
                <NavRow
                  title={project.name}
                  lines={briefLines(project)}
                  value={t(
                    project.submissionStatus === "submitted" ? "projectSubmitted" : "projectDraft",
                  )}
                  onPress={() => router.push(`/projects/${project.id}`)}
                />
              </View>
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </>
  );
}

function CircleButton({
  icon,
  label,
  onPress,
}: {
  icon: SymbolViewProps["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.surface,
        borderRadius: 22,
        height: 44,
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
        width: 44,
      })}
    >
      <SymbolView name={icon} tintColor={colors.accent} size={19} weight="semibold" />
    </Pressable>
  );
}

/** A labelled Liquid Glass button; two share a row evenly, one fills it. */
function GlassPill({
  icon,
  label,
  value,
  accessibilityLabel,
  onPress,
}: {
  icon: SymbolViewProps["name"];
  label: string;
  value?: string;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <GlassView
      colorScheme="auto"
      glassEffectStyle="regular"
      isInteractive
      style={{ borderCurve: "continuous", borderRadius: 999, flex: 1 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        onPress={onPress}
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: 8,
          justifyContent: "center",
          minHeight: 52,
          paddingHorizontal: 16,
        }}
      >
        <SymbolView name={icon} tintColor={colors.accent} size={19} accessible={false} />
        <Text numberOfLines={1} style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>
          {label}
        </Text>
        {value ? <Text style={{ color: colors.secondaryLabel, fontSize: 17 }}>{value}</Text> : null}
      </Pressable>
    </GlassView>
  );
}
