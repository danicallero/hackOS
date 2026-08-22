import { type ReactNode, useEffect, useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { AnnouncementFormModal, announcementToForm } from "@/components/announcement-form-modal";
import { EmptyState, Section, Separator, StatusPill } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ScheduleSwipeRow } from "@/components/schedule-swipe-row";
import { StaleDataBanner } from "@/components/stale-data-banner";
import {
  type AdminAnnouncement,
  type AnnouncementInput,
  createAnnouncement,
  deleteAnnouncement,
  fetchAdminAnnouncements,
  fetchAnnouncement,
  updateAnnouncement,
} from "@/lib/announcements-admin";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors } from "@/theme/colors";

type AnnouncementStatus = "scheduled" | "live" | "expired";

function announcementStatus(a: AdminAnnouncement): AnnouncementStatus {
  const now = Date.now();
  if (a.expires_at && new Date(a.expires_at).getTime() <= now) return "expired";
  if (a.publish_at && new Date(a.publish_at).getTime() > now) return "scheduled";
  return "live";
}

function statusLabel(status: AnnouncementStatus, t: ReturnType<typeof useLocale>["t"]): string {
  switch (status) {
    case "scheduled":
      return t("dataStatusScheduled");
    case "live":
      return t("statusLive");
    case "expired":
      return t("statusExpired");
  }
}

function statusTone(status: AnnouncementStatus): "warning" | "success" | "neutral" {
  switch (status) {
    case "scheduled":
      return "warning";
    case "live":
      return "success";
    case "expired":
      return "neutral";
  }
}

/**
 * Announcement management (H50, DELTA 0722), reached from the Notifications
 * tab's "Manage" segment when the account holds ANNOUNCEMENTS_MANAGE. Mirrors
 * the Schedule tab's own admin pattern: swipeable rows reveal edit/delete,
 * and both the swipe's edit action and the header's Add button open
 * `AnnouncementFormModal`.
 */
export function ManageAnnouncementsView({
  tabSwitcher,
  androidTopInset,
  formOpen,
  onFormOpenChange,
}: {
  tabSwitcher: ReactNode;
  androidTopInset: number;
  /** "create" | an existing row's id | null — lifted so the header Add button (owned by the parent) can open this view's form. */
  formOpen: "create" | number | null;
  onFormOpenChange: (next: "create" | number | null) => void;
}) {
  const { t, language } = useLocale();
  const [refreshing, setRefreshing] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminAnnouncement | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  const { data, loading, error, staleSince, load } = useCachedApi(
    "admin-announcements",
    fetchAdminAnnouncements,
  );
  const items = data ?? [];

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (typeof formOpen !== "number") {
      setEditTarget(null);
      return;
    }
    let cancelled = false;
    setEditLoading(true);
    void fetchAnnouncement(formOpen)
      .then((full) => {
        if (!cancelled) setEditTarget(full);
      })
      .finally(() => {
        if (!cancelled) setEditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [formOpen]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function submitForm(values: AnnouncementInput) {
    if (formOpen === "create") {
      await createAnnouncement(values);
    } else if (typeof formOpen === "number") {
      await updateAnnouncement(formOpen, values);
    }
    onFormOpenChange(null);
    await load();
  }

  async function removeEntry(item: AdminAnnouncement) {
    try {
      await deleteAnnouncement(item.id);
      await load();
    } catch {
      Alert.alert(t("announcementDeleteError"));
    }
  }

  function confirmDelete(item: AdminAnnouncement) {
    void haptic("warning");
    Alert.alert(t("announcementDeleteConfirmTitle"), t("announcementDeleteConfirmMessage"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("announcementDelete"),
        style: "destructive",
        onPress: () => void removeEntry(item),
      },
    ]);
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: 16,
          padding: 16,
          paddingBottom: 32,
          paddingTop: 16 + androidTopInset,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        {tabSwitcher}
        <StaleDataBanner updatedAt={staleSince} onRetry={() => void load()} retrying={loading} />

        {error ? <RequestFeedback error={error} onRetry={() => void load()} /> : null}
        {loading && !data ? <RequestFeedback loading /> : null}

        {!loading && !error && items.length === 0 ? (
          <EmptyState
            icon="megaphone.fill"
            title={t("announcementEmptyTitle")}
            description={t("announcementEmpty")}
          />
        ) : null}

        {items.length ? (
          <Section>
            {items.map((item, index) => {
              const status = announcementStatus(item);
              return (
                <View key={item.id}>
                  {index > 0 ? <Separator inset={16} /> : null}
                  <ScheduleSwipeRow
                    enabled
                    editLabel={t("announcementEdit")}
                    deleteLabel={t("announcementDelete")}
                    onEdit={() => onFormOpenChange(item.id)}
                    onDelete={() => confirmDelete(item)}
                  >
                    <View style={{ gap: 6, paddingHorizontal: 16, paddingVertical: 14 }}>
                      <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
                        <Text
                          selectable
                          numberOfLines={1}
                          style={{ color: colors.label, flex: 1, fontSize: 16, fontWeight: "600" }}
                        >
                          {item.title}
                        </Text>
                        <StatusPill tone={statusTone(status)}>{statusLabel(status, t)}</StatusPill>
                      </View>
                      <Text
                        selectable
                        numberOfLines={2}
                        style={{ color: colors.secondaryLabel, fontSize: 14 }}
                      >
                        {item.body}
                      </Text>
                      <Text style={{ color: colors.tertiaryLabel, fontSize: 12 }}>
                        {new Date(item.created_at).toLocaleDateString(language, {
                          day: "numeric",
                          month: "short",
                        })}
                      </Text>
                    </View>
                  </ScheduleSwipeRow>
                </View>
              );
            })}
          </Section>
        ) : null}
      </ScrollView>

      {formOpen === "create" ? (
        <AnnouncementFormModal
          visible
          onClose={() => onFormOpenChange(null)}
          onSubmit={submitForm}
        />
      ) : typeof formOpen === "number" && editTarget && !editLoading ? (
        <AnnouncementFormModal
          visible
          onClose={() => onFormOpenChange(null)}
          initial={announcementToForm(editTarget)}
          initialRecipients={editTarget.recipients}
          announcementId={editTarget.id}
          onSubmit={submitForm}
        />
      ) : null}
    </>
  );
}
