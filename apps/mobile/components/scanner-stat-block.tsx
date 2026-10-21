import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { type } from "@/theme";
import { colors } from "@/theme/colors";
import { CHROME_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/dynamic-type";
import {
  STAT_PRIMARY_COMPACT_TYPE,
  STAT_PRIMARY_TYPE,
  type StatBlockLayout,
} from "@/theme/layout-screens";

export interface ScannerStat {
  label: string;
  value: ReactNode;
  /** A hairline before the stat (occupancy sits apart from the counts). */
  divider?: boolean;
}

/**
 * The primary count and its supporting counts. A wide column shows one row of equal columns
 * with the primary first; a narrow one puts the primary above a row; accessibility text sizes
 * give each count its own line. Same tree in every layout, so resizing never remounts it.
 */
export function ScannerStatBlock({
  primary,
  secondary,
  layout,
  capped = true,
}: {
  primary: ScannerStat;
  secondary: ScannerStat[];
  layout: StatBlockLayout;
  /** Cap Dynamic Type on the counts (the general scanner caps them; the activity one wraps). */
  capped?: boolean;
}) {
  const compact = layout === "compact";
  const row = layout === "row" || compact;
  const list = layout === "list";
  const cap = capped ? CHROME_MAX_FONT_SIZE_MULTIPLIER : undefined;
  return (
    <View
      style={{
        borderBottomColor: colors.separator,
        alignItems: row ? "flex-end" : undefined,
        borderBottomWidth: 1,
        flexDirection: row ? "row" : "column",
        gap: compact ? 12 : row ? 16 : 24,
        paddingBottom: compact ? 8 : 24,
        paddingTop: compact ? 8 : 20,
      }}
    >
      <View style={{ flex: row ? 1 : undefined, gap: 4 }}>
        <Text
          selectable
          maxFontSizeMultiplier={cap}
          style={{
            color: colors.label,
            fontVariant: ["tabular-nums"],
            ...(compact ? STAT_PRIMARY_COMPACT_TYPE : STAT_PRIMARY_TYPE),
          }}
        >
          {primary.value}
        </Text>
        <Text
          selectable
          maxFontSizeMultiplier={cap}
          style={{ ...type.subhead, color: colors.secondaryLabel }}
        >
          {primary.label}
        </Text>
      </View>
      <View style={{ flex: row ? 2 : undefined, flexDirection: list ? "column" : "row", gap: 16 }}>
        {secondary.map((stat) => (
          <View
            key={stat.label}
            style={{
              flex: list ? undefined : 1,
              gap: 5,
              ...(stat.divider && !list
                ? { borderLeftColor: colors.separator, borderLeftWidth: 1, paddingLeft: 16 }
                : {}),
            }}
          >
            <Text
              selectable
              maxFontSizeMultiplier={cap}
              style={{
                ...(compact ? type.headline : type.title),
                color: colors.label,
                fontVariant: ["tabular-nums"],
                fontWeight: "600",
              }}
            >
              {stat.value}
            </Text>
            <Text
              selectable
              maxFontSizeMultiplier={cap}
              style={{ ...type.footnote, color: colors.secondaryLabel, lineHeight: 18 }}
            >
              {stat.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
