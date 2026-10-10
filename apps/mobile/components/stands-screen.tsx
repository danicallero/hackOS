import { useFocusEffect, useScrollToTop } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { AndroidStatusBarScrim, EmptyState, Section, Separator } from "@/components/native-ui";
import { NfcReader } from "@/components/nfc-reader";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { useMeContext } from "@/lib/me-context";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { filterStands, type StandSummary, standLinkErrorKey } from "@/lib/stands";
import { canManageStands } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useNfcSupportStatus } from "@/lib/use-nfc-supported";
import { colors } from "@/theme/colors";

/**
 * #935 staff flow: pick an enterprise and tap its NFC tag to link it to the
 * stand. `sponsors:manage` only, like the web Stands page. R008: "Link NFC
 * tag" starts reading immediately; QR codes are printed from the web.
 */
export function StandsScreen() {
  useColorScheme();
  const { t } = useLocale();
  const { me } = useMeContext();
  const allowed = canManageStands(me?.capabilities ?? []);
  const nfcStatus = useNfcSupportStatus();
  const nfcSupported = nfcStatus === "supported";
  const androidTopInset = useAndroidTopInset();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  const [stands, setStands] = useState<StandSummary[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<StandSummary | null>(null);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const data = await apiFetch<{ stands: StandSummary[] }>("/api/enterprises/stands");
      setStands(data.stands);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [allowed]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function link(stand: StandSummary, uid: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setLinkingId(stand.enterpriseId);
    setLinked(null);
    try {
      await apiFetch(`/api/enterprises/${stand.enterpriseId}/stand-tags`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({ kind: "nfc", uid }),
      });
      void haptic("success");
      setLinked(t("standsLinked", { name: stand.name }));
      setStands((current) =>
        (current ?? []).map((item) =>
          item.enterpriseId === stand.enterpriseId
            ? { ...item, nfcCount: item.nfcCount + 1 }
            : item,
        ),
      );
    } catch (err) {
      void haptic("error");
      Alert.alert(t("standsLinkNfc"), t(standLinkErrorKey(err)));
    } finally {
      inFlight.current = false;
      setLinkingId(null);
    }
  }

  if (!allowed) {
    return <EmptyState icon="lock.fill" title={t("requestUnavailable")} />;
  }

  const visible = stands ? filterStands(stands, query) : [];

  return (
    <View style={{ flex: 1 }}>
      <NfcReader
        visible={target !== null}
        onValue={(uid) => {
          const stand = target;
          if (stand) void link(stand, uid);
        }}
        onClose={() => setTarget(null)}
      />
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
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
          gap: 16,
          padding: 16,
          paddingBottom: Math.max(32, tabBarBottomInset + 16),
          paddingTop: 16 + androidTopInset,
        }}
      >
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderCurve: "continuous",
            borderRadius: 12,
            flexDirection: "row",
            gap: 8,
            height: 44,
            paddingHorizontal: 12,
          }}
        >
          <SymbolView
            accessible={false}
            name="magnifyingglass"
            size={17}
            tintColor={colors.secondaryLabel}
          />
          <TextInput
            accessibilityLabel={t("standsSearchPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder={t("standsSearchPlaceholder")}
            placeholderTextColor={colors.tertiaryLabel}
            returnKeyType="search"
            style={{ color: colors.label, flex: 1, fontSize: 17, paddingVertical: 0 }}
            value={query}
          />
        </View>

        {nfcStatus === "unsupported" ? (
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 15, lineHeight: 20 }}>
            {t("standsNfcUnavailable")}
          </Text>
        ) : null}

        {linked ? (
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            style={{
              alignItems: "center",
              backgroundColor: colors.successSurface,
              borderCurve: "continuous",
              borderRadius: 12,
              flexDirection: "row",
              gap: 10,
              padding: 14,
            }}
          >
            <SymbolView
              accessible={false}
              name="checkmark.circle.fill"
              size={20}
              tintColor={colors.success}
            />
            <Text selectable style={{ color: colors.onSuccessSurface, flex: 1, fontSize: 15 }}>
              {linked}
            </Text>
          </View>
        ) : null}

        {error && !stands ? (
          <RequestFeedback error={error} onRetry={() => void load()} />
        ) : stands === null ? (
          <RequestFeedback loading />
        ) : visible.length === 0 ? (
          <EmptyState icon="building.2" title={t("standsEmpty")} />
        ) : (
          <Section>
            {visible.map((stand, index) => (
              <View key={stand.enterpriseId}>
                {index > 0 ? <Separator inset={64} /> : null}
                <StandRow
                  stand={stand}
                  busy={linkingId === stand.enterpriseId}
                  disabled={!nfcSupported || linkingId !== null || target !== null}
                  onLink={() => {
                    setLinked(null);
                    setTarget(stand);
                  }}
                />
              </View>
            ))}
          </Section>
        )}
      </ScrollView>
      <AndroidStatusBarScrim />
    </View>
  );
}

function StandRow({
  stand,
  busy,
  disabled,
  onLink,
}: {
  stand: StandSummary;
  busy: boolean;
  disabled: boolean;
  onLink: () => void;
}) {
  const { t } = useLocale();
  const detail = stand.scannable
    ? t("standsCounts", { nfc: String(stand.nfcCount), qr: String(stand.qrCount) })
    : `${t("standsNotScannable")} · ${t("standsCounts", {
        nfc: String(stand.nfcCount),
        qr: String(stand.qrCount),
      })}`;
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        minHeight: 64,
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: "#ffffff",
          borderColor: colors.separator,
          borderRadius: 18,
          borderWidth: 1,
          height: 36,
          justifyContent: "center",
          overflow: "hidden",
          width: 36,
        }}
      >
        {stand.logoUrl ? (
          <Image
            accessible={false}
            source={{ uri: stand.logoUrl }}
            resizeMode="contain"
            style={{ height: 24, width: 24 }}
          />
        ) : (
          <Text style={{ color: "#3c3c43", fontSize: 13, fontWeight: "700" }}>
            {stand.name.slice(0, 1).toUpperCase()}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: colors.label, fontSize: 16, fontWeight: "600" }}>
          {stand.name}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.secondaryLabel, fontSize: 13 }}>
          {detail}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("standsLinkNfcFor", { name: stand.name })}
        accessibilityState={{ disabled: disabled || busy, busy }}
        disabled={disabled || busy}
        hitSlop={6}
        onPress={() => {
          void haptic("light");
          onLink();
        }}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: colors.surface,
          borderColor: colors.separator,
          borderCurve: "continuous",
          borderRadius: 16,
          borderWidth: 1,
          flexDirection: "row",
          gap: 6,
          minHeight: 34,
          opacity: disabled && !busy ? 0.45 : pressed ? 0.7 : 1,
          paddingHorizontal: 12,
        })}
      >
        {busy ? (
          <ActivityIndicator color={colors.accent} size="small" />
        ) : (
          <SymbolView accessible={false} name="wave.3.right" size={15} tintColor={colors.accent} />
        )}
        <Text style={{ color: colors.accent, fontSize: 15, fontWeight: "600" }}>
          {t("standsLinkNfc")}
        </Text>
      </Pressable>
    </View>
  );
}

export default StandsScreen;
