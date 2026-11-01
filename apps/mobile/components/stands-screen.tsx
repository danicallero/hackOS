import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppActivityIndicator } from "@/components/app-activity-indicator";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import {
  AndroidStatusBarScrim,
  EmptyState,
  LegacyHeaderIconButton,
  LegacyScreenHeader,
  Section,
  Separator,
} from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import {
  StandLinkResult,
  StandLogo,
  StandNfcModal,
  useStandTagLink,
} from "@/components/stand-tag-link";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { useBarTitleOptions } from "@/lib/bar-title";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { safeBack } from "@/lib/navigation";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { filterStands, type StandSummary } from "@/lib/stands";
import { canManageStands } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useNfcSupportStatus } from "@/lib/use-nfc-supported";
import { useTrueTopScroll } from "@/lib/use-true-top-scroll";
import { colors } from "@/theme/colors";
import { isAccessibilityTextSize } from "@/theme/dynamic-type";
import { type } from "@/theme/tokens";

const LOGO_SIZE = 40;

/**
 * #935 staff flow: every company with its tag counts. A row opens the
 * company's tags (`stand/[id]`, where scanning is turned on or off and tags
 * are removed); its NFC button starts reading at once (R008) and the result
 * offers "Link another" for the same company, so several tags are linked in a
 * row. Search is the native header search on iOS 26 and `LegacyScreenHeader`
 * elsewhere, as on People. `sponsors:manage` only, like the web Company tags
 * page. QR codes are printed from the web.
 */
export function StandsScreen() {
  useColorScheme();
  const { t } = useLocale();
  const barTitle = useBarTitleOptions(t("standsTitle"));
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { me } = useMeContext();
  const allowed = canManageStands(me?.capabilities ?? []);
  const nfcStatus = useNfcSupportStatus();
  const nfcSupported = nfcStatus === "supported";
  const glassAvailable = isRealLiquidGlassAvailable();
  const androidTopInset = useAndroidTopInset();
  const legacyTopInset = process.env.EXPO_OS === "ios" ? insets.top : androidTopInset;
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  const trueTop = useTrueTopScroll(scrollRef);
  const [stands, setStands] = useState<StandSummary[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { active, outcome, link, cancel } = useStandTagLink((stand, tag) =>
    setStands((current) =>
      (current ?? []).map((item) =>
        item.enterpriseId === stand.enterpriseId
          ? { ...item, nfcCount: item.nfcCount + 1, tags: [...item.tags, tag] }
          : item,
      ),
    ),
  );

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

  // Reloads on return from a company, where tags may have been removed.
  useFocusEffect(
    useCallback(() => {
      void load();
      return cancel;
    }, [load, cancel]),
  );

  useLayoutEffect(() => {
    if (!glassAvailable) {
      navigation.setOptions({ headerShown: false });
      return;
    }
    navigation.setOptions({
      ...barTitle,
      headerShown: true,
      headerTransparent: true,
      headerShadowVisible: false,
      headerSearchBarOptions: {
        placeholder: t("standsSearchPlaceholder"),
        autoCapitalize: "none",
        hideWhenScrolling: true,
        allowToolbarIntegration: false,
        placement: "integratedButton",
        onChangeText: (event: { nativeEvent: { text: string } }) =>
          setQuery(event.nativeEvent.text),
        onCancelButtonPress: () => setQuery(""),
      },
    });
  }, [barTitle, glassAvailable, navigation, t]);

  if (!allowed) {
    return <EmptyState icon="lock.fill" title={t("requestUnavailable")} />;
  }

  const visible = stands ? filterStands(stands, query) : [];
  const openStand = (stand: StandSummary) =>
    router.push({
      pathname: "/others/stand/[id]",
      params: { id: String(stand.enterpriseId), name: stand.name },
    });

  const list = (
    <ScrollView
      ref={scrollRef}
      {...trueTop.scrollProps}
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      refreshControl={
        <AppRefreshControl
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
      }}
    >
      <StandNfcModal stand={active} onCancel={cancel} />
      {nfcStatus === "unsupported" ? (
        <Text
          selectable
          style={{ color: colors.secondaryLabel, fontSize: type.subhead.fontSize, lineHeight: 20 }}
        >
          {t("standsNfcUnavailable")}
        </Text>
      ) : null}

      {outcome ? (
        <StandLinkResult
          outcome={outcome}
          action={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("standsLinkNfcFor", { name: outcome.stand.name })}
              disabled={!nfcSupported || active !== null}
              onPress={() => void link(outcome.stand)}
              style={({ pressed }) => ({
                alignItems: "center",
                alignSelf: "flex-start",
                flexDirection: "row",
                gap: 6,
                marginLeft: 30,
                minHeight: 36,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{ color: colors.accent, fontSize: type.subhead.fontSize, fontWeight: "600" }}
              >
                {t("standsLinkAnother")}
              </Text>
            </Pressable>
          }
        />
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
              {index > 0 ? <Separator inset={16 + LOGO_SIZE + 12} /> : null}
              <StandRow
                stand={stand}
                busy={active?.enterpriseId === stand.enterpriseId}
                disabled={!nfcSupported || active !== null}
                onOpen={() => openStand(stand)}
                onLink={() => void link(stand)}
              />
            </View>
          ))}
        </Section>
      )}
    </ScrollView>
  );

  // Native large-title header: the ScrollView must be the screen's root so the
  // header collapses with it. Only the legacy custom header needs a wrapper.
  if (glassAvailable) return list;
  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <LegacyScreenHeader
        actions={null}
        cancelLabel={t("cancel")}
        leading={
          <LegacyHeaderIconButton
            icon="chevron.left"
            accessibilityLabel={t("back")}
            onPress={() => safeBack(router, "/(tabs)/others/account")}
          />
        }
        onCloseSearch={() => {
          setSearchOpen(false);
          setQuery("");
        }}
        onOpenSearch={() => setSearchOpen(true)}
        onSearchQueryChange={setQuery}
        searchLabel={t("scheduleSearch")}
        searchOpen={searchOpen}
        searchPlaceholder={t("standsSearchPlaceholder")}
        searchQuery={query}
        title={t("standsTitle")}
        topInset={legacyTopInset}
      />
      {list}
      <AndroidStatusBarScrim />
    </View>
  );
}

function StandRow({
  stand,
  busy,
  disabled,
  onOpen,
  onLink,
}: {
  stand: StandSummary;
  busy: boolean;
  disabled: boolean;
  onOpen: () => void;
  onLink: () => void;
}) {
  const accessibilityText = isAccessibilityTextSize(useWindowDimensions().fontScale);
  const { t } = useLocale();
  // The name and the chevron are two targets around the NFC button; both open
  // the company, so the whole row highlights while either is held.
  const [pressed, setPressed] = useState(false);
  const press = {
    onPress: onOpen,
    onPressIn: () => setPressed(true),
    onPressOut: () => setPressed(false),
  };
  const counts = t("standsCounts", { nfc: String(stand.nfcCount), qr: String(stand.qrCount) });
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: pressed ? colors.elevatedSurface : "transparent",
        flexDirection: "row",
        minHeight: 64,
      }}
    >
      <Pressable
        {...press}
        accessibilityRole="button"
        accessibilityLabel={stand.name}
        accessibilityHint={stand.scannable ? counts : `${counts}, ${t("standsNotScannable")}`}
        style={{
          alignItems: "center",
          alignSelf: "stretch",
          flex: 1,
          flexDirection: "row",
          gap: 12,
          paddingLeft: 16,
          paddingRight: 8,
          paddingVertical: 12,
        }}
      >
        <StandLogo stand={stand} size={LOGO_SIZE} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            numberOfLines={accessibilityText ? undefined : 1}
            style={{ color: colors.label, fontSize: type.body.fontSize, fontWeight: "600" }}
          >
            {stand.name}
          </Text>
          <Text
            numberOfLines={1}
            style={{ color: colors.secondaryLabel, fontSize: type.compact.fontSize }}
          >
            {counts}
            {stand.scannable ? null : ` · ${t("standsNotScannable")}`}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("standsLinkNfcFor", { name: stand.name })}
        accessibilityState={{ disabled: disabled || busy, busy }}
        disabled={disabled || busy}
        onPress={() => {
          void haptic("light");
          onLink();
        }}
        style={({ pressed }) => ({
          alignItems: "center",
          height: 44,
          justifyContent: "center",
          opacity: disabled && !busy ? 0.35 : pressed ? 0.6 : 1,
          width: 44,
        })}
      >
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.accentSurface,
            borderRadius: 16,
            height: 32,
            justifyContent: "center",
            width: 32,
          }}
        >
          {busy ? (
            <AppActivityIndicator color={colors.onAccentSurface} size="small" />
          ) : (
            <SymbolView
              accessible={false}
              name="wave.3.right"
              size={15}
              weight="semibold"
              tintColor={colors.onAccentSurface}
            />
          )}
        </View>
      </Pressable>
      <Pressable
        {...press}
        accessible={false}
        importantForAccessibility="no"
        style={{
          alignItems: "center",
          alignSelf: "stretch",
          justifyContent: "center",
          paddingLeft: 4,
          paddingRight: 16,
        }}
      >
        <SymbolView
          accessible={false}
          name="chevron.right"
          size={13}
          weight="semibold"
          tintColor={colors.tertiaryLabel}
        />
      </Pressable>
    </View>
  );
}

export default StandsScreen;
