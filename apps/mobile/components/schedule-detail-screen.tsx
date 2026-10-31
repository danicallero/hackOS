import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { GlassView, isRealLiquidGlassAvailable } from "@/components/glass-view";
import { HeaderBackButton } from "@/components/header-back-button";
import { EmptyState, LegacyHeaderIconButton } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import {
  ScheduleFormModal,
  scheduleItemToForm,
  scheduleItemToTranslations,
} from "@/components/schedule-form-modal";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { eventZoneHint, formatEventTime, useEventTimeZone } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { safeBack } from "@/lib/navigation";
import {
  type AdminScheduleItem,
  collapseBlankLines,
  fetchAdminSchedule,
  fetchPublicSchedule,
  resolveScheduleText,
  SCHEDULE_POLL_MS,
  type ScheduleAudience,
  type ScheduleInput,
  type ScheduleOwner,
  scheduleDurationLabel,
  scheduleTypeLabel,
  updateScheduleItem,
  upsertScheduleItem,
} from "@/lib/schedule";
import { canManageSchedule, canReadFullSchedule } from "@/lib/tabs";
import { useCachedApi } from "@/lib/use-cached-api";
import { itemCategory, useScheduleNotifications } from "@/lib/use-schedule-notifications";
import { useStreamRefresh } from "@/lib/use-stream-refresh";
import { colors, radius, type } from "@/theme";
import { CHROME_MAX_FONT_SIZE_MULTIPLIER, CHROME_MIN_FONT_SCALE } from "@/theme/dynamic-type";
import { useParticipantLayout } from "@/theme/layout-participant";

const CONTENT_PADDING = 20;
const noTextShadow = {
  textShadowColor: "transparent" as const,
  textShadowOffset: { height: 0, width: 0 },
  textShadowRadius: 0,
};

const sectionHeaderStyle = {
  color: colors.secondaryLabel,
  fontSize: type.footnote.fontSize,
  fontWeight: "600" as const,
  ...noTextShadow,
  textTransform: "uppercase" as const,
};

/**
 * One schedule item. As a route it owns its native header; `embedded` (the detail pane of a
 * two-pane Schedule on an expanded window) draws a plain title row instead and has no back.
 */
export function ScheduleDetailScreen({
  id: idProp,
  embedded = false,
  editSignal = 0,
  onScrollOffset,
  topInset = 0,
}: {
  id?: string;
  embedded?: boolean;
  /** Bumped by the host (the side-column pencil) to open the editor. */
  editSignal?: number;
  /** Embedded: reports the scroll offset so the host can fade in its top band. */
  onScrollOffset?: (offset: number) => void;
  /** Embedded: the host's top band the content starts below. */
  topInset?: number;
}) {
  const params = useLocalSearchParams<{ id: string }>();
  const id = idProp ?? params.id;
  const router = useRouter();
  // Decided at mount, like the person profile (H59).
  const [coldLink] = useState(() => !router.canGoBack());
  const { t, language } = useLocale();
  const { me } = useMeContext();
  const insets = useSafeAreaInsets();
  const readable = useParticipantLayout("form");
  const canManage = canManageSchedule(me?.capabilities ?? []);
  const canReadFull = canReadFullSchedule(me?.capabilities ?? []);
  const focusedRef = useRef(false);
  const streamDownRef = useRef<() => boolean>(() => true);
  const whileFocused = useCallback(() => focusedRef.current && streamDownRef.current(), []);
  const { data, loading, error, staleSince, load, setData } = useCachedApi(
    "schedule",
    fetchPublicSchedule,
    { pollMs: SCHEDULE_POLL_MS, pollWhen: whileFocused },
  );
  // Schedule edits arrive over the payload-free stream; the poll is only a
  // backup while that stream is disconnected.
  streamDownRef.current = useStreamRefresh(() => void load(), { publicContent: true });
  const notifications = useScheduleNotifications(data ?? []);
  const [editing, setEditing] = useState(false);
  const [adminItem, setAdminItem] = useState<AdminScheduleItem | null>(null);
  useEffect(() => {
    if (editSignal > 0) setEditing(true);
  }, [editSignal]);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void load();
      return () => {
        focusedRef.current = false;
      };
    }, [load]),
  );

  useEffect(() => {
    void notifications.load();
  }, [notifications.load]);

  // `data` changes on every refresh and after a save, so the staff copy
  // (owners, drafts, translations) is re-read along with it.
  useEffect(() => {
    void data;
    if (!canReadFull) {
      setAdminItem(null);
      return;
    }
    let cancelled = false;
    fetchAdminSchedule()
      .then((items) => {
        if (cancelled) return;
        const match = items.find((candidate) => String(candidate.id) === id);
        setAdminItem(match ?? null);
      })
      .catch(() => {
        // Keep the last staff copy; the public read above reports load errors.
      });
    return () => {
      cancelled = true;
    };
  }, [canReadFull, id, data]);

  const rawItem = data?.find((candidate) => String(candidate.id) === id) ?? null;
  // H50 extension: resolve into the viewer's language here so the rest of
  // this screen keeps reading plain item.title/item.description unchanged.
  const item = rawItem ? { ...rawItem, ...resolveScheduleText(rawItem, language) } : null;
  const reminderOn = item && notifications.ready ? notifications.isEntrySubscribed(item) : null;
  const usesCustomAndroidHeader = process.env.EXPO_OS === "android";
  const glassAvailable = isRealLiquidGlassAvailable();

  async function saveEdit(
    values: ScheduleInput,
    _pendingOwners: ({ userId: number } | { freeTextName: string })[],
  ): Promise<AdminScheduleItem> {
    if (!item) throw new Error("No schedule item to edit");
    return updateScheduleItem(item.id, values);
  }

  function finishEditSave(updated: AdminScheduleItem) {
    setAdminItem((current) => ({ ...updated, owners: current?.owners ?? [] }));
    setData((current) => upsertScheduleItem(current, updated));
    setEditing(false);
  }
  // The admin endpoint returns the canonical columns too. Resolve its
  // translated fields before using it for the staff detail view (H50).
  const detailItem = adminItem
    ? { ...adminItem, ...resolveScheduleText(adminItem, language) }
    : item;
  const staffItem = adminItem ?? (item?.notes !== undefined ? item : null);
  const staffOnly = (staffItem?.audiences ?? []).length === 0;
  const showStaffVisibility = Boolean(staffItem && !staffOnly);
  const showStaffPublishAt = staffItem?.visibility === "hidden" && !staffOnly;
  const eventZone = useEventTimeZone();
  const zoneHint = eventZoneHint(language, eventZone);
  const startsAt = detailItem ? new Date(detailItem.startsAt) : null;
  const endsAt = detailItem ? new Date(detailItem.endsAt) : null;
  const clock = { hour: "2-digit", minute: "2-digit" } as const;
  const date = startsAt
    ? formatEventTime(
        startsAt,
        language,
        { weekday: "long", day: "numeric", month: "long" },
        eventZone,
      )
    : undefined;
  const time =
    startsAt && endsAt
      ? `${formatEventTime(startsAt, language, clock, eventZone)}–${formatEventTime(endsAt, language, clock, eventZone)}${zoneHint ? ` ${zoneHint}` : ""}`
      : null;
  const headerTitle = truncateHeaderTitle(item?.title ?? t("scheduleDetails"));

  return (
    <>
      {embedded ? null : usesCustomAndroidHeader ? (
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.background,
            flexDirection: "row",
            gap: 8,
            height: insets.top + 60,
            left: 0,
            paddingBottom: 4,
            paddingHorizontal: 16,
            paddingTop: insets.top + 8,
            position: "absolute",
            right: 0,
            shadowColor: "#000000",
            shadowOffset: { height: 2, width: 0 },
            shadowOpacity: 0.08,
            shadowRadius: 6,
            top: 0,
            zIndex: 10,
          }}
        >
          <GlassView
            colorScheme="auto"
            glassEffectStyle="regular"
            isInteractive
            style={{ borderRadius: radius.full, height: 44, width: 44 }}
          >
            <LegacyHeaderIconButton
              accessibilityLabel={t("back")}
              icon="chevron.left"
              onPress={() => safeBack(router, "/(tabs)/schedule")}
            />
          </GlassView>
          <Text
            ellipsizeMode="tail"
            numberOfLines={1}
            maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
            adjustsFontSizeToFit
            minimumFontScale={CHROME_MIN_FONT_SCALE}
            selectable
            style={[
              noTextShadow,
              {
                color: colors.label,
                flex: 1,
                flexBasis: 0,
                fontSize: type.title2.fontSize,
                fontWeight: "700",
                flexShrink: 1,
                height: 30,
                includeFontPadding: false,
                lineHeight: 30,
                minWidth: 0,
                overflow: "hidden",
                width: 0,
              },
            ]}
          >
            {headerTitle}
          </Text>
          {item && reminderOn !== null ? (
            <GlassView
              colorScheme="auto"
              glassEffectStyle="regular"
              isInteractive
              style={{ borderRadius: radius.full, height: 44, width: 44 }}
            >
              <LegacyHeaderIconButton
                accessibilityLabel={t(reminderOn ? "scheduleReminderOn" : "scheduleReminderOff", {
                  name: item.title,
                })}
                accessibilityState={{ selected: reminderOn }}
                icon={reminderOn ? "bell.fill" : "bell"}
                tintColor={reminderOn ? colors.accent : colors.label}
                onPress={() => void notifications.toggleEntry(item)}
              />
            </GlassView>
          ) : null}
        </View>
      ) : (
        <Stack.Screen
          options={{
            // Let UIKit own the large-to-compact title transition. It keeps
            // the activity name alongside the explicit back and reminder items
            // and applies its own single-line tail ellipsis when collapsed.
            title: item?.title ?? t("scheduleDetails"),
            // The native back item is a glass circle while the root Stack
            // keeps its minimal display mode. A cold deep link has nothing to
            // pop, so it gets an equivalent explicit back action (H59).
            headerBackVisible: !coldLink,
            headerLeft: coldLink
              ? () => <HeaderBackButton onPress={() => safeBack(router, "/(tabs)/schedule")} />
              : undefined,
            headerRight:
              item && reminderOn !== null && !glassAvailable
                ? () => (
                    <Pressable
                      accessibilityLabel={t(
                        reminderOn ? "scheduleReminderOn" : "scheduleReminderOff",
                        {
                          name: item.title,
                        },
                      )}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: reminderOn,
                        busy: notifications.savingKey === itemCategory(item.id),
                      }}
                      disabled={notifications.savingKey === itemCategory(item.id)}
                      hitSlop={12}
                      onPress={() => void notifications.toggleEntry(item)}
                      style={{
                        opacity: notifications.savingKey === itemCategory(item.id) ? 0.4 : 1,
                      }}
                    >
                      <SymbolView
                        name={reminderOn ? "bell.fill" : "bell"}
                        tintColor={reminderOn ? colors.accent : colors.label}
                        size={20}
                      />
                    </Pressable>
                  )
                : undefined,
          }}
        />
      )}
      {!embedded && glassAvailable && !usesCustomAndroidHeader && item ? (
        <Stack.Toolbar placement="right">
          {reminderOn !== null ? (
            <Stack.Toolbar.Button
              icon={reminderOn ? "bell.fill" : "bell"}
              accessibilityLabel={t(reminderOn ? "scheduleReminderOn" : "scheduleReminderOff", {
                name: item.title,
              })}
              disabled={notifications.savingKey === itemCategory(item.id)}
              selected={reminderOn}
              tintColor={reminderOn ? colors.accent : undefined}
              onPress={() => void notifications.toggleEntry(item)}
            />
          ) : null}
          {canManage ? (
            <Stack.Toolbar.Button
              icon="pencil"
              accessibilityLabel={t("scheduleEdit")}
              onPress={() => setEditing(true)}
            />
          ) : null}
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior={embedded ? "never" : "automatic"}
        onScroll={
          embedded ? (event) => onScrollOffset?.(event.nativeEvent.contentOffset.y) : undefined
        }
        scrollEventThrottle={16}
        refreshControl={
          <AppRefreshControl onRefresh={() => void onRefresh()} refreshing={refreshing} />
        }
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: 40,
          // Embedded in the two-pane layout the pane already bounds the column.
          ...(embedded ? { paddingHorizontal: CONTENT_PADDING } : readable.content),
          paddingTop: embedded ? topInset + 8 : usesCustomAndroidHeader ? insets.top + 76 : 0,
        }}
        style={{ backgroundColor: colors.background, flex: 1 }}
      >
        <View style={{ gap: 8 }}>
          <StaleDataBanner updatedAt={staleSince} />
          {notifications.error ? (
            <RequestFeedback
              error={notifications.error}
              message={t("scheduleReminderError")}
              onRetry={notifications.retry}
              retrying={notifications.savingKey !== null}
            />
          ) : null}
        </View>

        {!item ? (
          loading && !data ? (
            <RequestFeedback loading />
          ) : error && !data ? (
            <RequestFeedback error={error} onRetry={() => void load()} />
          ) : (
            <EmptyState
              icon="calendar.badge.exclamationmark"
              title={t("scheduleDetails")}
              description={t("scheduleItemUnavailable")}
            />
          )
        ) : (
          <View style={{ gap: 24 }}>
            {detailItem?.description ? (
              <View style={{ gap: 10 }}>
                <Text style={sectionHeaderStyle}>{t("scheduleDescription")}</Text>
                <Text
                  selectable
                  style={[
                    noTextShadow,
                    { color: colors.label, fontSize: type.callout.fontSize, lineHeight: 24 },
                  ]}
                >
                  {collapseBlankLines(detailItem.description)}
                </Text>
              </View>
            ) : null}

            <View style={{ gap: 8 }}>
              <Text style={sectionHeaderStyle}>{t("scheduleInformation")}</Text>
              <View
                style={{
                  backgroundColor: colors.surface,
                  borderCurve: "continuous",
                  borderRadius: radius.container,
                  paddingHorizontal: 16,
                }}
              >
                <PlainInfoRow label={t("scheduleType")} value={scheduleTypeLabel(item.type, t)} />
                <PlainInfoRow
                  label={t("scheduleDuration")}
                  value={scheduleDurationLabel(item, t)}
                />
                {date ? <PlainInfoRow label={t("scheduleDate")} value={date} /> : null}
                {time ? <PlainInfoRow label={t("scheduleTime")} value={time} /> : null}
                {item.location ? (
                  <PlainInfoRow label={t("scheduleLocation")} value={item.location} last />
                ) : null}
              </View>
            </View>

            {staffItem ? (
              <>
                <View style={{ gap: 8 }}>
                  <Text style={sectionHeaderStyle}>{t("scheduleStaffInformation")}</Text>
                  <View
                    style={{
                      backgroundColor: colors.surface,
                      borderCurve: "continuous",
                      borderRadius: radius.container,
                      paddingHorizontal: 16,
                    }}
                  >
                    <PlainInfoRow
                      label={t("scheduleFilterAudience")}
                      value={scheduleAudienceSummary(staffItem, t)}
                      last={staffOnly}
                    />
                    {!staffOnly && adminItem ? (
                      <PlainInfoRow
                        label={t("scheduleRequiresScanLabel")}
                        value={adminItem.requiresScan ? t("yesLabel") : t("noLabel")}
                      />
                    ) : null}
                    {showStaffVisibility ? (
                      <PlainInfoRow
                        label={t("scheduleVisibilityLabel")}
                        value={staffItem.visibility === "shown" ? t("yesLabel") : t("noLabel")}
                        last={!showStaffPublishAt}
                      />
                    ) : null}
                    {showStaffPublishAt ? (
                      <PlainInfoRow
                        label={t("schedulePublishAtLabel")}
                        value={
                          staffItem.publishAt
                            ? formatEventTime(
                                staffItem.publishAt,
                                language,
                                { dateStyle: "medium", timeStyle: "short" },
                                eventZone,
                              )
                            : t("accountNotSet")
                        }
                        last
                      />
                    ) : null}
                  </View>
                  <Text
                    style={[
                      noTextShadow,
                      { color: colors.secondaryLabel, fontSize: type.footnote.fontSize },
                    ]}
                  >
                    {t("scheduleStaffSeeAllHint")}
                  </Text>
                </View>

                {staffItem.notes ? (
                  <DetailTextSection label={t("scheduleNotesLabel")} value={staffItem.notes} />
                ) : null}
              </>
            ) : null}

            {/* contactNote/owners: sent for sponsors too (public payload), so
                render straight off `detailItem` rather than gating behind
                staffItem (staff-only), or sponsors never see the contact info
                the API already sent them. */}
            {detailItem?.contactNote ? (
              <DetailTextSection
                label={t("scheduleContactNoteLabel")}
                value={detailItem.contactNote}
              />
            ) : null}
            {detailItem?.owners ? (
              <View style={{ gap: 8 }}>
                <Text style={sectionHeaderStyle}>{t("scheduleOwnersLabel")}</Text>
                <Text
                  selectable
                  style={[
                    noTextShadow,
                    { color: colors.label, fontSize: type.callout.fontSize, lineHeight: 24 },
                  ]}
                >
                  {detailItem.owners.length > 0
                    ? detailItem.owners.map(ownerDisplayName).join(", ")
                    : t("scheduleOwnersEmpty")}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      {!embedded && canManage && item && !glassAvailable ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          style={{
            borderRadius: radius.full,
            bottom: Math.max(16, insets.bottom),
            height: 52,
            position: "absolute",
            right: 16,
            width: 52,
          }}
        >
          <Pressable
            accessibilityLabel={t("scheduleEdit")}
            accessibilityRole="button"
            onPress={() => setEditing(true)}
            style={{ alignItems: "center", flex: 1, justifyContent: "center" }}
          >
            <SymbolView name="pencil" tintColor={colors.accent} size={20} weight="semibold" />
          </Pressable>
        </GlassView>
      ) : null}

      {editing && adminItem ? (
        <ScheduleFormModal
          visible
          onClose={() => {
            setEditing(false);
          }}
          initial={scheduleItemToForm(adminItem, language)}
          initialTranslations={scheduleItemToTranslations(adminItem, language)}
          scheduleId={adminItem.id}
          initialOwners={adminItem.owners}
          onSaved={finishEditSave}
          onSubmit={saveEdit}
        />
      ) : null}
    </>
  );
}

function scheduleAudienceSummary(
  item: Pick<AdminScheduleItem, "audiences">,
  t: ReturnType<typeof useLocale>["t"],
): string {
  if (item.audiences.length === 0) return t("scheduleStaffOnlyBadge");
  return item.audiences.map((audience) => scheduleAudienceLabel(audience, t)).join(", ");
}

function scheduleAudienceLabel(
  audience: ScheduleAudience,
  t: ReturnType<typeof useLocale>["t"],
): string {
  switch (audience) {
    case "participant":
      return t("scheduleAudienceParticipant");
    case "sponsor":
      return t("scheduleAudienceSponsor");
    case "mentor":
      return t("scheduleAudienceMentor");
  }
}

function ownerDisplayName(owner: ScheduleOwner): string {
  if (owner.freeTextName) return owner.freeTextName;
  return [owner.name, owner.surname].filter(Boolean).join(" ").trim() || owner.email || "";
}

function truncateHeaderTitle(title: string): string {
  // Keep the fallback header deterministic on Android. Its Text ellipsize
  // implementation can wrap before applying the tail ellipsis when it sits
  // between two fixed-size icon buttons.
  const maxCharacters = 22;
  return title.length > maxCharacters ? `${title.slice(0, maxCharacters - 1)}…` : title;
}

function DetailTextSection({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={sectionHeaderStyle}>{label}</Text>
      <Text
        selectable
        style={[
          noTextShadow,
          { color: colors.label, fontSize: type.callout.fontSize, lineHeight: 24 },
        ]}
      >
        {collapseBlankLines(value)}
      </Text>
    </View>
  );
}

/** Full-bleed label/value row, no card — mirrors Podcasts' plain "Information" list. */
function PlainInfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        borderBottomColor: colors.separator,
        borderBottomWidth: last ? 0 : 0.5,
        flexDirection: "row",
        gap: 12,
        justifyContent: "space-between",
        paddingVertical: 14,
      }}
    >
      <Text
        selectable
        style={[noTextShadow, { color: colors.secondaryLabel, fontSize: type.callout.fontSize }]}
      >
        {label}
      </Text>
      <Text
        selectable
        style={[
          noTextShadow,
          {
            color: colors.label,
            flexShrink: 1,
            fontSize: type.callout.fontSize,
            textAlign: "right",
          },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}
