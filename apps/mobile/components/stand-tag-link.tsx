import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Image, Modal, Platform, Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/symbol";
import { ApiError, apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { startNfcRead } from "@/lib/nfc-reader";
import { type StandSummary, type StandTag, standLinkErrorKey } from "@/lib/stands";
import { colors } from "@/theme/colors";

/** The result line after a tap, for the company the tag was linked to. */
export interface StandLinkOutcome {
  stand: Pick<StandSummary, "enterpriseId" | "name">;
  tone: "success" | "warning";
  text: string;
}

type NfcRead = ReturnType<typeof startNfcRead>;
type LinkTarget = Pick<StandSummary, "enterpriseId" | "name">;

const NFC_ERRORS = new Set(["scannerNfcUnavailable", "scannerNfcDisabled", "scannerNfcInvalidTag"]);

/**
 * #935: links an NFC tag or wristband to a company by its serial number, the
 * same read-and-claim tap as accrediting a badge (`startNfcRead` with
 * `claimBadge`). Shared by the Company tags list and the company detail, so
 * both start reading on the first tap (R008).
 */
export function useStandTagLink(onLinked: (stand: LinkTarget, tag: StandTag) => void) {
  const { t } = useLocale();
  const [active, setActive] = useState<LinkTarget | null>(null);
  const [outcome, setOutcome] = useState<StandLinkOutcome | null>(null);
  const session = useRef<NfcRead | null>(null);
  const linked = useRef(onLinked);
  linked.current = onLinked;

  useEffect(() => () => session.current?.cancel(), []);

  useEffect(() => {
    // Only a real background ends the read: presenting the Core NFC sheet
    // itself makes the app `inactive`, and cancelling then closed it at once.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") session.current?.cancel();
    });
    return () => subscription.remove();
  }, []);

  async function link(stand: LinkTarget) {
    if (session.current) return;
    setOutcome(null);
    setActive(stand);
    // #935: exactly like badge accreditation, the tag is read and given the
    // app claim inside the NFC session, and the serial is linked afterwards.
    // Waiting on the network while holding the tag lost it on real hardware.
    // The claim is the same record every badge carries, so writing it to a
    // tag the API then refuses (someone's badge) changes nothing.
    const current = startNfcRead(t("standsNfcPrompt"), { claimBadge: true });
    session.current = current;
    try {
      const uid = await current.result;
      if (!uid) return;
      const tag = await apiFetch<StandTag>(`/api/enterprises/${stand.enterpriseId}/stand-tags`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ kind: "nfc", uid }),
      });
      linked.current(stand, tag);
      const prepared = !current.claimFailed();
      void haptic(prepared ? "success" : "warning");
      setOutcome({
        stand,
        tone: prepared ? "success" : "warning",
        text: t(prepared ? "standsLinked" : "standsLinkedWriteFailed", { name: stand.name }),
      });
    } catch (err) {
      void haptic("error");
      const key = err instanceof Error && NFC_ERRORS.has(err.message) ? err.message : null;
      const message = t(key ? (key as MessageKey) : standLinkErrorKey(err));
      // Unmapped API errors keep the server's explicit reason visible.
      const reason =
        !key && err instanceof ApiError && standLinkErrorKey(err) === "standsLinkFailed"
          ? err.message
          : null;
      Alert.alert(t("standsLinkNfc"), reason ? `${message}\n\n${reason}` : message);
    } finally {
      if (session.current === current) session.current = null;
      setActive(null);
    }
  }

  const cancel = useCallback(() => session.current?.cancel(), []);

  return { active, outcome, setOutcome, link, cancel };
}

/** Android has no system NFC sheet; this stands in for it while a read is open. */
export function StandNfcModal({
  stand,
  onCancel,
}: {
  stand: LinkTarget | null;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <Modal
      transparent
      animationType="fade"
      visible={stand !== null && Platform.OS === "android"}
      onRequestClose={onCancel}
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
          <SymbolView accessible={false} name="wave.3.right" size={48} tintColor={colors.accent} />
          <Text
            accessibilityRole="header"
            style={{ color: colors.label, fontSize: 22, fontWeight: "700", textAlign: "center" }}
          >
            {stand?.name}
          </Text>
          <Text style={{ color: colors.secondaryLabel, fontSize: 17, textAlign: "center" }}>
            {t("standsNfcPrompt")}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onCancel}
            style={{ minHeight: 48, justifyContent: "center", alignSelf: "stretch" }}
          >
            <Text style={{ color: colors.accent, fontSize: 17, textAlign: "center" }}>
              {t("cancel")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** The tinted result line after a link; `action` is e.g. the list's "Link another". */
export function StandLinkResult({
  outcome,
  action,
}: {
  outcome: StandLinkOutcome;
  action?: ReactNode;
}) {
  const success = outcome.tone === "success";
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={{
        backgroundColor: success ? colors.successSurface : colors.warningSurface,
        borderCurve: "continuous",
        borderRadius: 14,
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
        <SymbolView
          accessible={false}
          name={success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"}
          size={20}
          tintColor={success ? colors.success : colors.warning}
        />
        <Text
          selectable
          style={{
            color: success ? colors.onSuccessSurface : colors.onWarningSurface,
            flex: 1,
            fontSize: 15,
            lineHeight: 20,
          }}
        >
          {outcome.text}
        </Text>
      </View>
      {action}
    </View>
  );
}

/** A company's logo on white (logos are drawn for light backgrounds), or its initial. */
export function StandLogo({ stand, size }: { stand: StandSummary; size: number }) {
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: "#ffffff",
        borderColor: colors.separator,
        borderCurve: "continuous",
        borderRadius: size / 2,
        borderWidth: 0.5,
        height: size,
        justifyContent: "center",
        overflow: "hidden",
        width: size,
      }}
    >
      {stand.logoUrl ? (
        <Image
          accessible={false}
          source={{ uri: stand.logoUrl }}
          resizeMode="contain"
          style={{ height: size * 0.68, width: size * 0.68 }}
        />
      ) : (
        <Text style={{ color: "#3c3c43", fontSize: size * 0.4, fontWeight: "700" }}>
          {stand.name.slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}
