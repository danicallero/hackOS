import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { SlideInRight, SlideOutRight, useReducedMotion } from "react-native-reanimated";
import { useBackDismiss } from "@/components/app-back-gesture";
import { GlassView, isRealLiquidGlassAvailable } from "@/components/glass-view";
import MyQueueScreen from "@/components/my-queue-screen";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { GlassButton, NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { ApiError, apiFetch } from "@/lib/api";
import { useBarTitleOptions } from "@/lib/bar-title";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
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
import { useSideRegion } from "@/lib/side-region";
import { useCachedApi } from "@/lib/use-cached-api";
import { useTrueTopScroll } from "@/lib/use-true-top-scroll";
import { colors } from "@/theme/colors";
import { SCREEN_TITLE } from "@/theme/screen-title";

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
  const { me } = useMeContext();
  const cachePrefix = `user:${me?.id ?? "unknown"}`;
  const fetchProjects = useCallback(async () => {
    // H20: an editor closed a moment ago may still be saving its draft or name.
    await settleProjectDrafts();
    return apiFetch<{ projects: NativeProject[]; canCreate: boolean }>("/api/me/projects");
  }, []);
  const fetchInvites = useCallback(
    () => apiFetch<{ invites: ProjectInvite[] }>("/api/me/projects/invites"),
    [],
  );
  // Same cache entry as My queue, so either screen warms the other offline.
  const fetchQueue = useCallback(async () => {
    const entries = await apiFetch<ProjectQueueEntry[]>("/api/queue/me");
    return Array.isArray(entries) ? entries : [];
  }, []);
  const options = { enabled: me !== null, backgroundRevalidationMs: 0, cacheFirst: true };
  const mine = useCachedApi(`${cachePrefix}:projects`, fetchProjects, options);
  const invitations = useCachedApi(`${cachePrefix}:project-invites`, fetchInvites, options);
  const entries = useCachedApi(`${cachePrefix}:queue`, fetchQueue, options);
  const loadMine = mine.load;
  const loadInvites = invitations.load;
  const loadQueue = entries.load;
  const load = useCallback(
    () => Promise.all([loadMine(), loadInvites(), loadQueue()]).then(() => undefined),
    [loadMine, loadInvites, loadQueue],
  );
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);
  const projects = mine.data?.projects ?? null;
  const canCreate = mine.data?.canCreate ?? false;
  const invites = invitations.data?.invites ?? [];
  const queue = entries.data ?? [];
  // A failed secondary read must not hide the participant's own projects.
  const error = mine.error ?? (projects ? invitations.error : null);
  const staleSince = mine.staleSince;
  useFocusEffect(
    useCallback(() => {
      void load();
      return subscribeToCategory("queue", () => void load());
    }, [load]),
  );
  const glassAvailable = isRealLiquidGlassAvailable();
  const barTitle = useBarTitleOptions(t("projects"));
  const sideRegion = useSideRegion();
  const openInvites = useCallback(() => router.push("/queue/invites"), [router]);
  const openGallery = useCallback(() => router.push("/projects/gallery"), [router]);
  const [queueOpen, setQueueOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const closeQueue = useCallback(() => setQueueOpen(false), []);
  useBackDismiss(queueOpen, closeQueue);
  const openQueue = useCallback(() => setQueueOpen((current) => !current), []);
  const openNew = useCallback(() => router.push("/queue/new"), [router]);
  useLayoutEffect(() => {
    navigation.setOptions({
      // Beside a side column the title is a left toolbar item on the bar row, exactly like
      // Contacts, so the bar blurs the same way; elsewhere the native large title stays.
      ...(queueOpen || glassAvailable ? { title: "", headerLargeTitle: false } : barTitle),
      headerShown: true,
      gestureEnabled: !queueOpen,
      // Beside a side column the bar is just the page colour; elsewhere the screen keeps the
      // system bar it always had.
      ...(sideRegion.edge
        ? { headerTransparent: true, headerStyle: { backgroundColor: "transparent" } }
        : { headerTransparent: false, headerStyle: { backgroundColor: colors.background } }),
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
  }, [
    navigation,
    t,
    glassAvailable,
    canCreate,
    openNew,
    openQueue,
    barTitle,
    sideRegion.edge,
    queueOpen,
  ]);

  function briefLines(project: NativeProject) {
    return queueBriefFor(queue, project.id)
      .slice(0, 3)
      .map((entry) => {
        const status =
          entry.status === "waiting" && entry.position != null
            ? t("queuePosition", { n: String(entry.position) })
            : entry.status === "presenting" || entry.status === "in_room"
              ? t("queueBeInRoom")
              : t(STATUS_KEY[entry.status] ?? "queueStatusWaiting");
        const eta = entry.status === "waiting" ? formatEtaMinutes(entry.etaMinutes, t) : null;
        return [entry.challengeTitle, status, eta].filter(Boolean).join(" · ");
      });
  }
  return (
    <>
      {glassAvailable ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.View hidesSharedBackground>
            <Text accessibilityRole="header" style={{ color: colors.label, ...SCREEN_TITLE }}>
              {queueOpen ? "" : t("projects")}
            </Text>
          </Stack.Toolbar.View>
        </Stack.Toolbar>
      ) : null}
      {glassAvailable ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            separateBackground
            icon={queueOpen ? "xmark" : "list.number"}
            accessibilityLabel={queueOpen ? t("close") : t("projectQueue")}
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
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
        contentContainerStyle={{ gap: 24, padding: 16, paddingBottom: bottomInset + 24 }}
      >
        <StaleDataBanner updatedAt={staleSince} />
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
        {projects === null && !error ? <RequestFeedback loading={mine.loading} /> : null}
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
      {queueOpen ? (
        <Animated.View
          entering={reduceMotion ? undefined : SlideInRight.duration(220)}
          exiting={reduceMotion ? undefined : SlideOutRight.duration(220)}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: colors.background,
          }}
        >
          <MyQueueScreen embedded />
        </Animated.View>
      ) : null}
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
