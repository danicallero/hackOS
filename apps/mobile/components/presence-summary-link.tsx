import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable } from "react-native";
import { InfoRow, Section, Separator } from "@/components/native-ui";
import { formatMinutes, type PresenceTimeline } from "@/components/presence-management";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { guaranteedMinutesTotal } from "@/lib/presence-timeline";
import { colors } from "@/theme/colors";

/**
 * The profile's compact stand-in for the full presence timeline (H24): just
 * the consolidated guaranteed-hours stat, tappable through to the dedicated
 * subpage where the day-grouped cards, the add/edit flow, and any conflict
 * needing a manual fix actually live.
 */
export function PresenceSummaryLink({
  userId,
  refreshKey,
  onDoorState,
  accredited,
}: {
  userId: number;
  refreshKey?: string;
  /** Reports the server's last door log so the register can derive its direction from ground truth. */
  onDoorState?: (state: { kind: "in" | "out"; at: string } | null) => void;
  /** Hides this link for an unaccredited person with no signals yet — nothing to summarize. */
  accredited: boolean;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const [timeline, setTimeline] = useState<PresenceTimeline | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await apiFetch<PresenceTimeline>(`/api/presence/timeline/${userId}`);
      setTimeline(next);
      const lastDoor = [...next.signals].reverse().find((signal) => signal.source === "door");
      onDoorState?.(
        lastDoor ? { kind: lastDoor.kind as "in" | "out", at: lastDoor.occurredAt } : null,
      );
    } catch {
      // The subpage itself surfaces load errors with a retry; this compact
      // link just falls back to a dash rather than duplicating that UI.
    }
  }, [onDoorState, userId]);

  useEffect(() => {
    void refreshKey;
    void load();
  }, [load, refreshKey]);

  const hasSignals = (timeline?.signals.length ?? 0) > 0;
  if (!accredited && !hasSignals) return null;

  const guaranteedMinutes = guaranteedMinutesTotal(timeline?.windows ?? []);
  const conflictCount = timeline?.conflicts.length ?? 0;

  function open() {
    router.push({ pathname: "/(tabs)/scan/person/presence/[id]", params: { id: String(userId) } });
  }

  return (
    <Section title={t("presenceSummary")}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("presenceSummary")}
        onPress={open}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <InfoRow
          icon="checkmark.seal.fill"
          label={t("presenceGuaranteedHours")}
          value={timeline ? formatMinutes(guaranteedMinutes, t) : "—"}
          accessoryIcon="chevron.right"
          valueStyle={{ color: colors.success, fontVariant: ["tabular-nums"], fontWeight: "700" }}
        />
      </Pressable>
      {conflictCount > 0 ? (
        <>
          <Separator />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("presenceConflictTitle")}
            onPress={open}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <InfoRow
              icon="exclamationmark.triangle.fill"
              label={t("presenceConflictTitle")}
              value=""
              accessoryIcon="chevron.right"
              valueStyle={{ color: colors.destructive }}
            />
          </Pressable>
        </>
      ) : null}
    </Section>
  );
}
