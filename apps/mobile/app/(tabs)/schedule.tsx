import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  type GestureResponderEvent,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmptyState } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import {
  type AudienceFilterValue,
  ScheduleFilterButton,
} from "@/components/schedule-filter-button";
import { ScheduleFormModal, scheduleItemToForm } from "@/components/schedule-form-modal";
import { ScheduleNotificationsSheet } from "@/components/schedule-notifications-sheet";
import { ScheduleSwipeRow } from "@/components/schedule-swipe-row";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  addScheduleOwner,
  createScheduleItem,
  deleteScheduleItem,
  fetchAdminSchedule,
  fetchPublicSchedule,
  type ScheduleInput,
  type ScheduleItem,
  scheduleTypeLabel,
  updateScheduleItem,
} from "@/lib/schedule";
import { has } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useCachedApi } from "@/lib/use-cached-api";
import { itemCategory, useScheduleNotifications } from "@/lib/use-schedule-notifications";
import { colors } from "@/theme/colors";

type NowMarker = { kind: "now"; id: string };
type ItemRow = ScheduleItem & { kind: "item" };
type SectionRow = ItemRow | NowMarker;

interface ScheduleSection {
  key: string;
  title: string;
  data: SectionRow[];
}

const SECTION_HEADER_HEIGHT = 34;

function audienceMatches(item: ScheduleItem, selected: AudienceFilterValue[]): boolean {
  if (selected.length === 0) return true;
  if (item.audiences.length === 0) return selected.includes("staff");
  return item.audiences.some((audience) => selected.includes(audience));
}

/** Participant schedule backed by the same public read model used on web. */
export default function ScheduleScreen() {
  useColorScheme();
  const { t, language } = useLocale();
  const { me } = useMeContext();
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<SectionList<SectionRow, ScheduleSection>>(null);
  const scrolledOnLoad = useRef(false);
  const androidTopInset = useAndroidTopInset();
  const insets = useSafeAreaInsets();
  const headerTopInset = process.env.EXPO_OS === "ios" ? insets.top : androidTopInset;
  const canManage = has(me?.capabilities ?? [], CAPABILITIES.SCHEDULE_MANAGE);

  const { data, loading, error, staleSince, load } = useCachedApi("schedule", fetchPublicSchedule);
  const items = data ?? [];
  const notifications = useScheduleNotifications(items);

  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [selectedAudiences, setSelectedAudiences] = useState<AudienceFilterValue[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [formTarget, setFormTarget] = useState<"create" | ScheduleItem | null>(null);

  useEffect(() => {
    void load();
    void notifications.load();
  }, [load, notifications.load]);

  // Keeps the "now" line accurate without a full data reload.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const kinds = useMemo(
    () =>
      [
        ...new Set(items.map((item) => item.type).filter((type): type is string => Boolean(type))),
      ].sort(),
    [items],
  );

  const filteredItems = useMemo(
    () =>
      items.filter(
        (item) =>
          (selectedKinds.length === 0 || (item.type && selectedKinds.includes(item.type))) &&
          audienceMatches(item, selectedAudiences),
      ),
    [items, selectedKinds, selectedAudiences],
  );

  const todayKey = useMemo(() => new Date(now).toLocaleDateString("en-CA"), [now]);

  const sections = useMemo<ScheduleSection[]>(() => {
    const grouped = new Map<string, ScheduleItem[]>();
    for (const item of [...filteredItems].sort(
      (a, b) => safeTimestamp(a.startsAt) - safeTimestamp(b.startsAt),
    )) {
      const key = new Date(item.startsAt).toLocaleDateString("en-CA");
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()].map(([key, dayItems]) => {
      const rows: SectionRow[] = dayItems.map((item) => ({ ...item, kind: "item" as const }));
      if (key === todayKey) {
        const hasActiveItem = dayItems.some(
          (item) => safeTimestamp(item.startsAt) <= now && safeTimestamp(item.endsAt) >= now,
        );
        if (!hasActiveItem) {
          const markerIndex = dayItems.findIndex((item) => safeTimestamp(item.startsAt) > now);
          const insertAt = markerIndex === -1 ? rows.length : markerIndex;
          rows.splice(insertAt, 0, { kind: "now", id: "now-marker" });
        }
      }
      return {
        key,
        data: rows,
        title: new Date(dayItems[0].startsAt).toLocaleDateString(language, {
          weekday: "long",
          month: "long",
          day: "numeric",
        }),
      };
    });
  }, [filteredItems, language, now, todayKey]);

  // Jumps straight to "what's happening now" (or the marker between cards)
  // instead of opening at the beginning of a multi-day schedule.
  useEffect(() => {
    if (scrolledOnLoad.current || sections.length === 0) return;
    scrolledOnLoad.current = true;
    const sectionIndex = sections.findIndex((section) => section.key === todayKey);
    if (sectionIndex === -1) return;
    let itemIndex = sections[sectionIndex].data.findIndex((row) => row.kind === "now");
    if (itemIndex === -1) {
      itemIndex = sections[sectionIndex].data.findIndex(
        (row) =>
          row.kind === "item" &&
          safeTimestamp(row.startsAt) <= now &&
          safeTimestamp(row.endsAt) >= now,
      );
    }
    if (itemIndex === -1) return;
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToLocation({
          sectionIndex,
          itemIndex,
          viewOffset: 80,
          animated: false,
        });
      } catch {
        // Best-effort — a transient layout mismatch just means no auto-scroll this time.
      }
    });
  }, [now, sections, todayKey]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function toggleKind(kind: string) {
    void haptic("selection");
    setSelectedKinds((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind],
    );
  }

  function toggleAudience(audience: AudienceFilterValue) {
    void haptic("selection");
    setSelectedAudiences((current) =>
      current.includes(audience) ? current.filter((a) => a !== audience) : [...current, audience],
    );
  }

  async function deleteEntry(item: ScheduleItem) {
    try {
      await deleteScheduleItem(item.id);
      await load();
    } catch {
      Alert.alert(t("scheduleDeleteError"));
    }
  }

  function confirmDelete(item: ScheduleItem) {
    Alert.alert(t("scheduleDeleteConfirmTitle"), t("scheduleDeleteConfirmMessage"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("scheduleDelete"), style: "destructive", onPress: () => void deleteEntry(item) },
    ]);
  }

  async function submitForm(values: ScheduleInput, pendingOwnerIds: number[]) {
    if (formTarget === "create") {
      const created = await createScheduleItem(values);
      for (const userId of pendingOwnerIds) await addScheduleOwner(created.id, userId);
    } else if (formTarget) {
      await updateScheduleItem(formTarget.id, values);
    }
    setFormTarget(null);
    await load();
  }

  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <View
        style={{
          gap: 8,
          paddingHorizontal: 16,
          paddingTop: headerTopInset,
          // Above the list so the filter dropdown isn't clipped by the
          // SectionList's scroll container — it used to live inside
          // ListHeaderComponent, which clips absolutely-positioned overflow.
          zIndex: 10,
        }}
      >
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "space-between",
            paddingBottom: 4,
            paddingTop: 8,
          }}
        >
          <Text style={{ color: colors.label, fontSize: 34, fontWeight: "800" }}>
            {t("tabSchedule")}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ScheduleFilterButton
              kinds={kinds}
              selectedKinds={selectedKinds}
              onToggleKind={toggleKind}
              showAudience={canManage}
              selectedAudiences={selectedAudiences}
              onToggleAudience={toggleAudience}
              onClear={() => {
                setSelectedKinds([]);
                setSelectedAudiences([]);
              }}
            />
            {canManage ? (
              <HeaderGlassButton
                icon="plus"
                accessibilityLabel={t("scheduleAdd")}
                onPress={() => setFormTarget("create")}
              />
            ) : null}
            <HeaderGlassButton
              icon="bell.badge"
              accessibilityLabel={t("scheduleNotificationsTitle")}
              onPress={() => setSettingsOpen(true)}
            />
          </View>
        </View>
      </View>
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(row) => (row.kind === "now" ? row.id : String(row.id))}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        stickySectionHeadersEnabled
        onScrollToIndexFailed={() => {
          // Rows above collapse/expand height changes; a silent retry-free
          // failure is better than a crash — the user can just scroll manually.
        }}
        ListHeaderComponent={
          <View style={{ gap: 8 }}>
            <StaleDataBanner
              updatedAt={staleSince}
              onRetry={() => void load()}
              retrying={loading}
            />
            {notifications.error ? (
              <RequestFeedback
                error={notifications.error}
                message={t("scheduleReminderError")}
                onRetry={notifications.retry}
                retrying={notifications.savingKey !== null}
              />
            ) : null}
          </View>
        }
        ListHeaderComponentStyle={{ paddingHorizontal: 16, paddingTop: 8 }}
        ListEmptyComponent={
          loading ? (
            <RequestFeedback loading />
          ) : error ? (
            <RequestFeedback error={error} onRetry={() => void load()} />
          ) : (
            <EmptyState
              icon="calendar.badge.clock"
              title={t("scheduleEmptyTitle")}
              description={t("scheduleEmpty")}
            />
          )
        }
        renderSectionHeader={({ section }) => (
          <View
            style={{
              backgroundColor: colors.background,
              height: SECTION_HEADER_HEIGHT,
              justifyContent: "center",
            }}
          >
            <Text
              selectable
              accessibilityRole="header"
              style={{
                color: colors.secondaryLabel,
                fontSize: 13,
                fontWeight: "600",
                paddingHorizontal: 16,
                textTransform: "uppercase",
              }}
            >
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item, index, section }) =>
          item.kind === "now" ? (
            <View style={{ alignItems: "center", flexDirection: "row", gap: 8, padding: 16 }}>
              <View style={{ backgroundColor: colors.accent, flex: 1, height: 2 }} />
              <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "700" }}>
                {t("scheduleNow")}
              </Text>
              <View style={{ backgroundColor: colors.accent, flex: 1, height: 2 }} />
            </View>
          ) : (
            <ScheduleSwipeRow
              enabled={canManage}
              editLabel={t("scheduleEdit")}
              deleteLabel={t("scheduleDelete")}
              onEdit={() => setFormTarget(item)}
              onDelete={() => confirmDelete(item)}
            >
              <ScheduleCard
                item={item}
                language={language}
                last={index === section.data.length - 1}
                reminderOn={notifications.ready ? notifications.isEntrySubscribed(item) : null}
                reminderBusy={notifications.savingKey === itemCategory(item.id)}
                onToggleReminder={() => void notifications.toggleEntry(item)}
              />
            </ScheduleSwipeRow>
          )
        }
      />

      {formTarget === "create" ? (
        <ScheduleFormModal visible onClose={() => setFormTarget(null)} onSubmit={submitForm} />
      ) : formTarget ? (
        <AdminScheduleFormLoader
          target={formTarget}
          onClose={() => setFormTarget(null)}
          onSubmit={submitForm}
        />
      ) : null}

      <ScheduleNotificationsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        kinds={kinds}
        items={items}
        categoryState={notifications.categoryState}
        onToggleCategory={(kind, enabled) => void notifications.toggleCategory(kind, enabled)}
        isEntrySubscribed={(item) =>
          notifications.ready ? notifications.isEntrySubscribed(item) : false
        }
        onToggleEntry={(item) => void notifications.toggleEntry(item)}
        savingKey={notifications.savingKey}
      />
    </View>
  );
}

/**
 * The public feed doesn't carry admin-only fields (visibility, publishAt,
 * contactNote, notes, owners), so editing an existing item loads the full
 * admin record once the form opens instead of prefilling with placeholders.
 */
function AdminScheduleFormLoader({
  target,
  onClose,
  onSubmit,
}: {
  target: "create" | ScheduleItem | null;
  onClose: () => void;
  onSubmit: (values: ScheduleInput, pendingOwnerIds: number[]) => Promise<void>;
}) {
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof fetchAdminSchedule>> | null>(null);

  useEffect(() => {
    if (!target || target === "create") {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    void fetchAdminSchedule().then((items) => {
      if (!cancelled) setLoaded(items);
    });
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!target || target === "create") return null;
  const adminItem = loaded?.find((candidate) => candidate.id === target.id);
  if (!adminItem) return null;

  return (
    <ScheduleFormModal
      visible
      onClose={onClose}
      initial={scheduleItemToForm(adminItem)}
      scheduleId={adminItem.id}
      initialOwners={adminItem.owners}
      onSubmit={onSubmit}
    />
  );
}

function HeaderGlassButton({
  icon,
  accessibilityLabel,
  onPress,
}: {
  icon: "plus" | "bell.badge";
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={() => {
        void haptic("light");
        onPress();
      }}
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
      <SymbolView name={icon} tintColor={colors.label} size={19} weight="semibold" />
    </Pressable>
  );
}

function safeTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

const COLLAPSED_TITLE_LINES = 2;
const COLLAPSED_DESCRIPTION_LINES = 2;

/**
 * Whether a card is worth an expand affordance. `numberOfLines` clamps without
 * telling us it did, and `onTextLayout` needs a real layout pass, so we go by
 * length: short entries stay affordance-free, long ones collapse (H374).
 */
export function isScheduleCardExpandable(item: Pick<ScheduleItem, "title" | "description">) {
  const description = item.description ?? "";
  return description.includes("\n") || description.length > 90 || item.title.length > 60;
}

function ScheduleCard({
  item,
  language,
  last,
  reminderOn,
  reminderBusy,
  onToggleReminder,
}: {
  item: ScheduleItem;
  language: string;
  last: boolean;
  reminderOn: boolean | null;
  reminderBusy: boolean;
  onToggleReminder: () => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const expandable = isScheduleCardExpandable(item);
  const collapsed = expandable && !expanded;
  const startsAt = new Date(item.startsAt);
  const endsAt = new Date(item.endsAt);
  const time = startsAt.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  const end = endsAt.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });

  function toggleReminder(event: GestureResponderEvent) {
    event.stopPropagation();
    onToggleReminder();
  }

  return (
    <View
      style={{ backgroundColor: colors.background, flexDirection: "row", paddingHorizontal: 16 }}
    >
      <View style={{ alignItems: "center", width: 70 }}>
        <Text
          selectable
          style={{
            color: colors.label,
            fontSize: 15,
            fontVariant: ["tabular-nums"],
            fontWeight: "600",
          }}
        >
          {time}
        </Text>
        {!last ? (
          <View style={{ backgroundColor: colors.separator, flex: 1, marginTop: 8, width: 1 }} />
        ) : null}
      </View>
      <Pressable
        accessibilityLabel={[
          item.title,
          time,
          end,
          item.location,
          reminderOn === null
            ? null
            : t(reminderOn ? "scheduleReminderOn" : "scheduleReminderOff", {
                name: item.title,
              }),
        ]
          .filter(Boolean)
          .join(", ")}
        accessibilityRole="button"
        onPress={() => router.push({ pathname: "/schedule/[id]", params: { id: String(item.id) } })}
        style={{
          alignItems: "center",
          backgroundColor: colors.surface,
          borderCurve: "continuous",
          borderRadius: 14,
          flex: 1,
          flexDirection: "row",
          marginBottom: 12,
          marginLeft: 8,
        }}
      >
        <View style={{ flex: 1, gap: 9, padding: 16 }}>
          <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
            <Text
              selectable
              numberOfLines={collapsed ? COLLAPSED_TITLE_LINES : undefined}
              style={{ color: colors.label, flex: 1, fontSize: 17, fontWeight: "700" }}
            >
              {item.title}
            </Text>
            {reminderOn !== null ? (
              <Pressable
                accessibilityLabel={t(reminderOn ? "scheduleReminderOn" : "scheduleReminderOff", {
                  name: item.title,
                })}
                accessibilityRole="button"
                accessibilityState={{ selected: reminderOn, busy: reminderBusy }}
                disabled={reminderBusy}
                onPress={toggleReminder}
                // hitSlop instead of a 44pt box: the box stretched the header row
                // and pushed the bell off the title's baseline (H374).
                hitSlop={{ bottom: 14, left: 14, right: 14, top: 14 }}
                style={({ pressed }) => ({
                  alignItems: "center",
                  justifyContent: "center",
                  height: 22,
                  width: 22,
                  opacity: reminderBusy ? 0.4 : pressed ? 0.65 : 1,
                })}
              >
                <SymbolView
                  name={reminderOn ? "bell.fill" : "bell"}
                  tintColor={reminderOn ? colors.accent : colors.tertiaryLabel}
                  size={19}
                />
              </Pressable>
            ) : null}
          </View>
          <View style={{ alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {item.type ? (
              <>
                <Text
                  style={{
                    alignSelf: "center",
                    color: colors.secondaryLabel,
                    fontSize: 13,
                    fontWeight: "600",
                  }}
                >
                  {scheduleTypeLabel(item.type, t)}
                </Text>
                <Text style={{ color: colors.tertiaryLabel, fontSize: 13 }}>·</Text>
              </>
            ) : null}
            <Text
              selectable
              style={{
                color: colors.secondaryLabel,
                fontSize: 13,
                fontVariant: ["tabular-nums"],
              }}
            >
              {time}–{end}
            </Text>
            {item.location ? (
              <>
                <Text style={{ color: colors.tertiaryLabel, fontSize: 13 }}>·</Text>
                <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                  {item.location}
                </Text>
              </>
            ) : null}
          </View>
          {item.description ? (
            <Text
              selectable
              numberOfLines={collapsed ? COLLAPSED_DESCRIPTION_LINES : undefined}
              style={{ color: colors.secondaryLabel, fontSize: 15, lineHeight: 21 }}
            >
              {item.description}
            </Text>
          ) : null}
          {expandable ? (
            <Pressable
              accessibilityLabel={t(expanded ? "scheduleShowLess" : "scheduleShowMore")}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              hitSlop={{ bottom: 12, left: 12, right: 12, top: 12 }}
              onPress={(event) => {
                event.stopPropagation();
                void haptic("selection");
                setExpanded((current) => !current);
              }}
              style={({ pressed }) => ({
                alignItems: "center",
                alignSelf: "flex-start",
                flexDirection: "row",
                gap: 4,
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "600" }}>
                {t(expanded ? "scheduleShowLess" : "scheduleShowMore")}
              </Text>
              <SymbolView
                name={expanded ? "chevron.up" : "chevron.down"}
                tintColor={colors.accent}
                size={11}
                accessible={false}
              />
            </Pressable>
          ) : null}
        </View>
        <SymbolView
          name="chevron.right"
          tintColor={colors.tertiaryLabel}
          size={13}
          style={{ marginRight: 14 }}
        />
      </Pressable>
    </View>
  );
}
