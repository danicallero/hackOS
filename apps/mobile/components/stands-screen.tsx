import { useFocusEffect, useScrollToTop } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { AndroidStatusBarScrim, EmptyState, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import {
  type CompanyTagSession,
  type CompanyTagWrite,
  startCompanyTagSession,
} from "@/lib/company-tag-nfc";
import { haptic } from "@/lib/haptics";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { useMeContext } from "@/lib/me-context";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { filterStands, type StandSummary, type StandTag, standLinkErrorKey } from "@/lib/stands";
import { canManageStands } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useNfcSupportStatus } from "@/lib/use-nfc-supported";
import { colors } from "@/theme/colors";

/** The result line after a tap; "Link another" restarts for the same company. */
interface Outcome {
  stand: StandSummary;
  tone: "success" | "warning";
  text: string;
}

const WRITE_MESSAGE: Record<Exclude<CompanyTagWrite, "needsOverwrite" | "wrongTag">, MessageKey> = {
  written: "standsLinkedOpens",
  already: "standsLinkedOpens",
  readOnly: "standsLinkedReadOnly",
  failed: "standsLinkedWriteFailed",
};

const NFC_ERRORS = new Set(["scannerNfcUnavailable", "scannerNfcDisabled", "scannerNfcInvalidTag"]);

/**
 * #935 staff flow: pick a company and tap an NFC tag or wristband to link it
 * by its serial number, then write the company-tag link so tapping it opens
 * hackOS (`lib/company-tag-nfc.ts`). `sponsors:manage` only, like the web
 * Company tags page. R008: "Link tag" starts reading immediately, and after a
 * tag the result offers "Link another" for the same company, so several tags
 * are linked in a row without leaving the screen. QR codes are printed from
 * the web.
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
  const [active, setActive] = useState<{ stand: StandSummary; prompt: string } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const session = useRef<CompanyTagSession | null>(null);

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
      return () => session.current?.cancel();
    }, [load]),
  );

  useEffect(() => () => session.current?.cancel(), []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") session.current?.cancel();
    });
    return () => subscription.remove();
  }, []);

  function addTag(stand: StandSummary, tag: StandTag) {
    setStands((current) =>
      (current ?? []).map((item) =>
        item.enterpriseId === stand.enterpriseId
          ? { ...item, nfcCount: item.nfcCount + 1, tags: [...item.tags, tag] }
          : item,
      ),
    );
  }

  function finish(stand: StandSummary, write: Exclude<CompanyTagWrite, "needsOverwrite">) {
    if (write === "wrongTag") {
      void haptic("error");
      setOutcome({ stand, tone: "warning", text: t("standsWrongTag") });
      return;
    }
    void haptic(write === "written" || write === "already" ? "success" : "warning");
    setOutcome({
      stand,
      tone: write === "written" || write === "already" ? "success" : "warning",
      text: t(WRITE_MESSAGE[write], { name: stand.name }),
    });
  }

  async function run(
    stand: StandSummary,
    options: { prompt: MessageKey; expectedUid?: string; overwrite?: boolean },
  ) {
    if (session.current) return;
    setOutcome(null);
    setActive({ stand, prompt: t(options.prompt) });
    const current = startCompanyTagSession({
      prompt: t(options.prompt),
      expectedUid: options.expectedUid,
      overwrite: options.overwrite,
      link: options.expectedUid
        ? undefined
        : async (uid) => {
            const tag = await apiFetch<StandTag>(
              `/api/enterprises/${stand.enterpriseId}/stand-tags`,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "Idempotency-Key": createIdempotencyKey(),
                },
                body: JSON.stringify({ kind: "nfc", uid }),
              },
            );
            addTag(stand, tag);
          },
    });
    session.current = current;
    try {
      const result = await current.result;
      if (!result) return;
      if (result.write !== "needsOverwrite") {
        finish(stand, result.write);
        return;
      }
      // Linked by serial already; replacing other data needs a decision.
      Alert.alert(t("standsOverwriteTitle"), t("standsOverwriteBody"), [
        {
          text: t("standsKeep"),
          style: "cancel",
          onPress: () =>
            setOutcome({
              stand,
              tone: "warning",
              text: t("standsLinkedKept", { name: stand.name }),
            }),
        },
        {
          text: t("standsOverwrite"),
          onPress: () =>
            void run(stand, { prompt: "standsTapAgain", expectedUid: result.uid, overwrite: true }),
        },
      ]);
    } catch (err) {
      void haptic("error");
      const key = err instanceof Error && NFC_ERRORS.has(err.message) ? err.message : null;
      Alert.alert(
        t("standsLinkNfc"),
        t(
          key
            ? (key as MessageKey)
            : options.expectedUid
              ? "scannerNfcError"
              : standLinkErrorKey(err),
        ),
      );
    } finally {
      if (session.current === current) session.current = null;
      setActive(null);
    }
  }

  if (!allowed) {
    return <EmptyState icon="lock.fill" title={t("requestUnavailable")} />;
  }

  const visible = stands ? filterStands(stands, query) : [];

  return (
    <View style={{ flex: 1 }}>
      <Modal
        transparent
        animationType="fade"
        visible={active !== null && Platform.OS === "android"}
        onRequestClose={() => session.current?.cancel()}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.5)",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            accessibilityViewIsModal
            style={{
              backgroundColor: colors.background,
              borderRadius: 28,
              padding: 24,
              gap: 24,
              alignItems: "center",
            }}
          >
            <SymbolView
              accessible={false}
              name="wave.3.right"
              size={48}
              tintColor={colors.accent}
            />
            <Text
              accessibilityRole="header"
              style={{ color: colors.label, fontSize: 22, fontWeight: "700", textAlign: "center" }}
            >
              {active?.stand.name}
            </Text>
            <Text style={{ color: colors.secondaryLabel, fontSize: 17, textAlign: "center" }}>
              {active?.prompt}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => session.current?.cancel()}
              style={{ minHeight: 48, justifyContent: "center", alignSelf: "stretch" }}
            >
              <Text style={{ color: colors.accent, fontSize: 17, textAlign: "center" }}>
                {t("cancel")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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

        {outcome ? (
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            style={{
              backgroundColor:
                outcome.tone === "success" ? colors.successSurface : colors.warningSurface,
              borderCurve: "continuous",
              borderRadius: 12,
              gap: 12,
              padding: 14,
            }}
          >
            <View style={{ flexDirection: "row", gap: 10 }}>
              <SymbolView
                accessible={false}
                name={
                  outcome.tone === "success"
                    ? "checkmark.circle.fill"
                    : "exclamationmark.triangle.fill"
                }
                size={20}
                tintColor={outcome.tone === "success" ? colors.success : colors.warning}
              />
              <Text
                selectable
                style={{
                  color:
                    outcome.tone === "success" ? colors.onSuccessSurface : colors.onWarningSurface,
                  flex: 1,
                  fontSize: 15,
                  lineHeight: 20,
                }}
              >
                {outcome.text}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("standsLinkNfcFor", { name: outcome.stand.name })}
              disabled={!nfcSupported || active !== null}
              onPress={() => void run(outcome.stand, { prompt: "standsNfcPrompt" })}
              style={({ pressed }) => ({
                alignItems: "center",
                alignSelf: "flex-start",
                flexDirection: "row",
                gap: 6,
                minHeight: 36,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <SymbolView
                accessible={false}
                name="wave.3.right"
                size={15}
                tintColor={colors.accent}
              />
              <Text style={{ color: colors.accent, fontSize: 15, fontWeight: "600" }}>
                {t("standsLinkAnother")}
              </Text>
            </Pressable>
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
                  busy={active?.stand.enterpriseId === stand.enterpriseId}
                  disabled={!nfcSupported || active !== null}
                  onLink={() => void run(stand, { prompt: "standsNfcPrompt" })}
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
