import { Image } from "expo-image";
import { Link } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Easing, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { FavouriteStar } from "@/components/favourite-star";
import { EmptyState } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import {
  collectionProgress,
  companyMonogram,
  type SponsorCollection,
  type SponsorCollectionItem,
} from "@/lib/diary-sponsors";
import { useLocale } from "@/lib/i18n";
import { colors, radius, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

const MIN_CELL = 100;
const MAX_COLUMNS = 6;
const GRID_GAP = 12;

/**
 * Companies (#935): a sticker album of the sponsor stands an attendee can
 * collect by scanning them. Collected badges are in full colour and zoom into the
 * company page; the rest stay as locked silhouettes with their names, so
 * attendees know who is left to find.
 */
export function CompanyAlbum({
  collection,
  highlightId,
}: {
  collection: SponsorCollection;
  /** The company just collected by a scan; its badge celebrates once. */
  highlightId: number | null;
}) {
  const { t } = useLocale();
  const readable = useParticipantLayout("list");
  if (collection.items.length === 0) {
    return <EmptyState icon="building.2" title={t("diaryCompaniesEmpty")} />;
  }
  // At least MIN_CELL per badge inside the column; badges shrink on narrow phones.
  const columns = readable.columns(MIN_CELL, GRID_GAP, MAX_COLUMNS);
  const cell = readable.tile(columns, GRID_GAP);
  const size = Math.max(64, Math.min(88, Math.floor(cell) - 12));
  return (
    <View style={{ gap: 20 }}>
      <AlbumProgress collected={collection.collected} total={collection.total} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 20 }}>
        {collection.items.map((item) => (
          <View key={item.enterpriseId} style={{ width: `${100 / columns}%` }}>
            <CompanyBadge item={item} size={size} celebrate={item.enterpriseId === highlightId} />
          </View>
        ))}
      </View>
    </View>
  );
}

function AlbumProgress({ collected, total }: { collected: number; total: number }) {
  const { t } = useLocale();
  const size = 76;
  const stroke = 8;
  const ringRadius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * ringRadius;
  const progress = collectionProgress({ collected, total });
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t("diaryCompaniesProgress", {
        collected: String(collected),
        total: String(total),
      })}
      accessibilityValue={{ min: 0, max: total, now: collected }}
      style={{
        alignItems: "center",
        backgroundColor: colors.surface,
        borderCurve: "continuous",
        borderRadius: radius.container,
        flexDirection: "row",
        gap: 16,
        padding: 16,
      }}
    >
      <View style={{ alignItems: "center", height: size, justifyContent: "center", width: size }}>
        <Svg width={size} height={size} style={{ position: "absolute" }}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={ringRadius}
            stroke={colors.elevatedSurface as string}
            strokeWidth={stroke}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={ringRadius}
            stroke={colors.accent as string}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - progress)}
            fill="none"
            rotation={-90}
            origin={`${size / 2}, ${size / 2}`}
          />
        </Svg>
        <Text style={{ color: colors.label, fontSize: type.subhead.fontSize, fontWeight: "700" }}>
          {Math.round(progress * 100)}%
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.label, fontSize: type.title.fontSize, fontWeight: "700" }}>
          {collected}
          <Text
            style={{
              color: colors.secondaryLabel,
              fontSize: type.title3.fontSize,
              fontWeight: "600",
            }}
          >
            {` / ${total}`}
          </Text>
        </Text>
        <Text style={{ color: colors.secondaryLabel, fontSize: type.subhead.fontSize }}>
          {t("diaryCompaniesCollected")}
        </Text>
      </View>
    </View>
  );
}

/**
 * Drains the colour from whatever sits under it (the parent must `isolation: "isolate"`).
 * React Native's `filter` has no grayscale on iOS, and expo-image has no such prop.
 */
export function Desaturate() {
  return (
    <View
      pointerEvents="none"
      style={{
        backgroundColor: "gray",
        bottom: 0,
        left: 0,
        mixBlendMode: "saturation",
        position: "absolute",
        right: 0,
        top: 0,
      }}
    />
  );
}

/**
 * A round sticker: the logo on white in full colour once collected; until then
 * the same disc with the logo desaturated and faded, no lock or extra copy.
 */
function Medallion({
  item,
  size,
  collected,
}: {
  item: SponsorCollectionItem;
  size: number;
  collected: boolean;
}) {
  const logo = item.logoUrl;
  return (
    <View style={{ height: size, width: size }}>
      <View
        style={{
          alignItems: "center",
          // Logos are designed for a light ground, so the sticker stays white
          // in dark mode too.
          backgroundColor: colors.accentText,
          borderColor: colors.separator,
          borderRadius: size / 2,
          borderWidth: 1,
          boxShadow: collected ? "0 3px 10px rgba(0,0,0,0.14)" : undefined,
          height: size,
          justifyContent: "center",
          isolation: "isolate",
          overflow: "hidden",
          width: size,
        }}
      >
        {logo ? (
          <Image
            accessible={false}
            source={{ uri: logo }}
            contentFit="contain"
            style={{
              height: size * 0.74,
              opacity: collected ? 1 : 0.5,
              width: size * 0.74,
            }}
          />
        ) : (
          <Text
            style={{
              color: collected ? colors.label : colors.tertiaryLabel,
              fontSize: size * 0.3,
              fontWeight: "700",
            }}
          >
            {companyMonogram(item.name)}
          </Text>
        )}
        {collected ? null : <Desaturate />}
      </View>
      {collected && item.entry?.starred ? (
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderRadius: radius.full,
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            height: 26,
            justifyContent: "center",
            position: "absolute",
            right: -2,
            top: -2,
            width: 26,
          }}
        >
          <FavouriteStar on size={16} />
        </View>
      ) : null}
    </View>
  );
}

function CompanyBadge({
  item,
  size,
  celebrate,
}: {
  item: SponsorCollectionItem;
  size: number;
  celebrate: boolean;
}) {
  const { t } = useLocale();
  const collected = item.entry !== null;
  const scale = useRef(new Animated.Value(1)).current;
  const halo = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!celebrate) return;
    scale.setValue(0.4);
    halo.setValue(1);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
      Animated.timing(halo, {
        toValue: 0,
        duration: 1800,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [celebrate, halo, scale]);

  const content = (
    <View style={{ alignItems: "center", gap: 8 }}>
      <View style={{ alignItems: "center", justifyContent: "center" }}>
        <Animated.View
          pointerEvents="none"
          style={{
            borderColor: colors.accent,
            borderRadius: size,
            borderWidth: 4,
            height: size + 16,
            opacity: halo,
            position: "absolute",
            // A ripple that grows outward while it fades.
            transform: [{ scale: Animated.add(1.35, Animated.multiply(halo, -0.35)) }],
            width: size + 16,
          }}
        />
        {/* The zoom source is a plain, untransformed view: iOS snapshots it, and an animated
            transform on the source itself breaks the open and dismiss zoom. */}
        <Link.AppleZoom>
          <View style={{ height: size, width: size }}>
            <Animated.View style={{ transform: [{ scale }] }}>
              <Medallion item={item} size={size} collected={collected} />
            </Animated.View>
          </View>
        </Link.AppleZoom>
      </View>
      <Text
        numberOfLines={2}
        style={{
          color: collected ? colors.label : colors.secondaryLabel,
          fontSize: type.footnote.fontSize,
          fontWeight: collected ? "600" : "500",
          lineHeight: 16,
          textAlign: "center",
        }}
      >
        {item.name}
      </Text>
    </View>
  );

  return (
    <Link href={`/companies/${item.enterpriseId}`} asChild>
      <PressableFeedback
        feedback="opacity"
        accessibilityRole="button"
        accessibilityLabel={collected ? item.name : t("diaryCompanyLocked", { name: item.name })}
      >
        {content}
      </PressableFeedback>
    </Link>
  );
}
