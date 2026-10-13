import { useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useLayoutEffect, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useColorScheme,
  View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { ActionButton, AppSwitch, EmptyState, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import {
  StandLinkResult,
  StandLogo,
  StandNfcModal,
  useStandTagLink,
} from "@/components/stand-tag-link";
import { SymbolView } from "@/components/symbol";
import { ApiError, apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { useMeContext } from "@/lib/me-context";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import type { StandSummary, StandTag } from "@/lib/stands";
import { canManageStands } from "@/lib/tabs";
import { useNfcSupportStatus } from "@/lib/use-nfc-supported";
import { colors } from "@/theme/colors";

const CODE_FONT = Platform.select({ ios: "Menlo", default: "monospace" });
const TAG_ICON = 32;

/**
 * #935: one company's tags, pushed from Company tags. Scanning is turned on
 * or off here; "Link tag" reads an NFC tag or wristband at once (R008); a
 * tag is removed by swiping its row (or the VoiceOver/TalkBack action) after
 * a native confirmation. QR codes are generated and printed from the web.
 * Reads the staff list (`GET /api/enterprises/stands`), which carries the
 * scannable flag and every tag, so returning to the list shows the same data.
 */
export function StandDetailScreen() {
  useColorScheme();
  const { t } = useLocale();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const enterpriseId = Number(params.id);
  const { me } = useMeContext();
  const allowed = canManageStands(me?.capabilities ?? []);
  const nfcStatus = useNfcSupportStatus();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const [stand, setStand] = useState<StandSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [removing, setRemoving] = useState<Set<number>>(() => new Set());
  const { active, outcome, link, cancel } = useStandTagLink((_stand, tag) =>
    setStand((current) =>
      current
        ? { ...current, nfcCount: current.nfcCount + 1, tags: [...current.tags, tag] }
        : current,
    ),
  );

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const data = await apiFetch<{ stands: StandSummary[] }>("/api/enterprises/stands");
      const found = data.stands.find((item) => item.enterpriseId === enterpriseId) ?? null;
      setStand(found);
      setMissing(found === null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [allowed, enterpriseId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return cancel;
    }, [load, cancel]),
  );

  const title = stand?.name ?? params.name ?? "";
  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  /** Optimistic: flips at once and rolls back with an alert on failure. */
  async function setScannable(scannable: boolean) {
    if (!stand || scanBusy) return;
    const previous = stand.scannable;
    setScanBusy(true);
    setStand((current) => (current ? { ...current, scannable } : current));
    try {
      await apiFetch(`/api/enterprises/${stand.enterpriseId}/stand-scannable`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({ scannable }),
      });
      void haptic("light");
    } catch (err) {
      setStand((current) => (current ? { ...current, scannable: previous } : current));
      void haptic("error");
      Alert.alert(
        t("standsTitle"),
        err instanceof ApiError ? err.message : t("standsScannableFailed"),
      );
    } finally {
      setScanBusy(false);
    }
  }

  async function remove(tag: StandTag) {
    if (!stand || removing.has(tag.id)) return;
    setRemoving((current) => new Set(current).add(tag.id));
    try {
      await apiFetch(`/api/enterprises/${stand.enterpriseId}/stand-tags/${tag.id}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": createIdempotencyKey() },
      });
      void haptic("success");
      setStand((current) =>
        current
          ? {
              ...current,
              nfcCount: current.nfcCount - (tag.kind === "nfc" ? 1 : 0),
              qrCount: current.qrCount - (tag.kind === "qr" ? 1 : 0),
              tags: current.tags.filter((item) => item.id !== tag.id),
            }
          : current,
      );
    } catch (err) {
      void haptic("error");
      Alert.alert(
        t("standsRemoveTag"),
        err instanceof ApiError ? err.message : t("standsRemoveTagFailed"),
      );
    } finally {
      setRemoving((current) => {
        const next = new Set(current);
        next.delete(tag.id);
        return next;
      });
    }
  }

  function confirmRemove(tag: StandTag) {
    Alert.alert(
      t("standsRemoveTagConfirm"),
      // Only a QR has a consequence beyond this screen: its printed copies.
      tag.kind === "qr" ? t("standsRemoveQrDetail") : undefined,
      [
        { text: t("cancel"), style: "cancel" },
        { text: t("remove"), style: "destructive", onPress: () => void remove(tag) },
      ],
    );
  }

  if (!allowed) {
    return <EmptyState icon="lock.fill" title={t("requestUnavailable")} />;
  }

  const nfcTags = stand?.tags.filter((tag) => tag.kind === "nfc") ?? [];
  const qrTags = stand?.tags.filter((tag) => tag.kind === "qr") ?? [];

  return (
    // The ScrollView is the screen's root so the native large title can track
    // it and collapse; a wrapping View would draw content under the header.
    <ScrollView
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      contentContainerStyle={{
        gap: 24,
        padding: 16,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
      }}
    >
      <StandNfcModal stand={active} onCancel={cancel} />
      {error && !stand ? (
        <RequestFeedback error={error} onRetry={() => void load()} />
      ) : missing ? (
        <EmptyState icon="building.2" title={t("requestUnavailable")} />
      ) : stand === null ? (
        <RequestFeedback loading />
      ) : (
        <>
          <Section footer={stand.scannable ? undefined : t("standsNotScannableNotice")}>
            <View
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: 12,
                minHeight: 64,
                paddingHorizontal: 16,
                paddingVertical: 12,
              }}
            >
              <StandLogo stand={stand} size={40} />
              <Text style={{ color: colors.label, flex: 1, fontSize: 17 }}>
                {t("standsScannable")}
              </Text>
              <AppSwitch
                accessibilityLabel={t("standsScannableFor", { name: stand.name })}
                disabled={scanBusy}
                onValueChange={(value) => void setScannable(value)}
                value={stand.scannable}
              />
            </View>
          </Section>

          <View style={{ gap: 12 }}>
            <ActionButton
              variant="filled"
              icon="wave.3.right"
              label={t("standsLinkNfc")}
              busy={active !== null}
              disabled={nfcStatus !== "supported"}
              onPress={() => void link(stand)}
            />
            {nfcStatus === "unsupported" ? (
              <Text
                selectable
                style={{ color: colors.secondaryLabel, fontSize: 15, lineHeight: 20 }}
              >
                {t("standsNfcUnavailable")}
              </Text>
            ) : null}
            {outcome ? <StandLinkResult outcome={outcome} /> : null}
          </View>

          {stand.tags.length === 0 ? <EmptyState icon="tag" title={t("standsNoTags")} /> : null}
          {nfcTags.length > 0 ? (
            <TagSection
              title={t("standsNfcTags")}
              tags={nfcTags}
              removing={removing}
              onRemove={confirmRemove}
            />
          ) : null}
          {qrTags.length > 0 ? (
            <TagSection
              title={t("standsQrCodes")}
              tags={qrTags}
              removing={removing}
              onRemove={confirmRemove}
            />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function TagSection({
  title,
  tags,
  removing,
  onRemove,
}: {
  title: string;
  tags: StandTag[];
  removing: Set<number>;
  onRemove: (tag: StandTag) => void;
}) {
  return (
    <Section title={title}>
      {tags.map((tag, index) => (
        <View key={tag.id}>
          {index > 0 ? <Separator inset={16 + TAG_ICON + 12} /> : null}
          <TagRow tag={tag} busy={removing.has(tag.id)} onRemove={() => onRemove(tag)} />
        </View>
      ))}
    </Section>
  );
}

/**
 * Swiping reveals Remove (full opacity from the first pixel, like the badge
 * row on a person); the tag is removed only after the confirmation.
 */
function TagRow({ tag, busy, onRemove }: { tag: StandTag; busy: boolean; onRemove: () => void }) {
  const { t } = useLocale();
  const removeLabel = t("standsRemoveTagFor", { code: tag.label ?? tag.code });
  return (
    <Swipeable
      enabled={!busy}
      overshootRight={false}
      rightThreshold={40}
      renderRightActions={() => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={removeLabel}
          onPress={() => {
            void haptic("light");
            onRemove();
          }}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: colors.destructive,
            gap: 4,
            justifyContent: "center",
            opacity: pressed ? 0.8 : 1,
            width: 88,
          })}
        >
          <SymbolView accessible={false} name="trash.fill" size={18} tintColor="#ffffff" />
          <Text style={{ color: "#ffffff", fontSize: 13, fontWeight: "600" }}>{t("remove")}</Text>
        </Pressable>
      )}
    >
      <View
        accessible
        accessibilityLabel={tag.label ? `${tag.label}, ${tag.code}` : tag.code}
        accessibilityActions={[{ name: "remove", label: t("remove") }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "remove") onRemove();
        }}
        style={{
          alignItems: "center",
          backgroundColor: colors.surface,
          flexDirection: "row",
          gap: 12,
          minHeight: 56,
          opacity: busy ? 0.45 : 1,
          paddingHorizontal: 16,
          paddingVertical: 10,
        }}
      >
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.elevatedSurface,
            borderRadius: TAG_ICON / 2,
            height: TAG_ICON,
            justifyContent: "center",
            width: TAG_ICON,
          }}
        >
          <SymbolView
            accessible={false}
            name={tag.kind === "nfc" ? "wave.3.right" : "qrcode"}
            size={15}
            weight="semibold"
            tintColor={colors.secondaryLabel}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          {tag.label ? (
            <Text numberOfLines={1} style={{ color: colors.label, fontSize: 16 }}>
              {tag.label}
            </Text>
          ) : null}
          <Text
            numberOfLines={1}
            selectable
            style={{
              color: tag.label ? colors.secondaryLabel : colors.label,
              fontFamily: CODE_FONT,
              fontSize: tag.label ? 13 : 15,
            }}
          >
            {tag.code}
          </Text>
        </View>
      </View>
    </Swipeable>
  );
}

export default StandDetailScreen;
