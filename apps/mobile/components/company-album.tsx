import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { FavouriteStar } from "@/components/favourite-star";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { DetailRow, QuickAction } from "@/components/profile-parts";
import { SymbolView } from "@/components/symbol";
import {
  collectionProgress,
  companyMonogram,
  type SponsorCollection,
  type SponsorCollectionItem,
} from "@/lib/diary-sponsors";
import { displayUrl } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

const COLUMNS = 3;
const GRID_GAP = 12;
const ROW_ICON_INSET = 52;

/**
 * Companies (#935): a sticker album of the sponsor stands an attendee can
 * collect by scanning them. Collected badges are in full colour and open a
 * company sheet; the rest stay as locked silhouettes with their names, so
 * attendees know who is left to find.
 */
export function CompanyAlbum({
  collection,
  highlightId,
  onOpen,
}: {
  collection: SponsorCollection;
  /** The company just collected by a scan; its badge celebrates once. */
  highlightId: number | null;
  onOpen: (item: SponsorCollectionItem) => void;
}) {
  const { t } = useLocale();
  const { width } = useWindowDimensions();
  if (collection.items.length === 0) {
    return <EmptyState icon="building.2" title={t("diaryCompaniesEmpty")} />;
  }
  // Three columns inside the screen's 16pt gutters; badges shrink on narrow phones.
  const cell = (width - 32 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;
  const size = Math.max(64, Math.min(88, Math.floor(cell) - 12));
  return (
    <View style={{ gap: 20 }}>
      <AlbumProgress collected={collection.collected} total={collection.total} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 20 }}>
        {collection.items.map((item) => (
          <View key={item.enterpriseId} style={{ width: `${100 / COLUMNS}%` }}>
            <CompanyBadge
              item={item}
              size={size}
              celebrate={item.enterpriseId === highlightId}
              onOpen={() => onOpen(item)}
            />
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
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
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
        borderRadius: 20,
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
            r={radius}
            stroke={colors.elevatedSurface as string}
            strokeWidth={stroke}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
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
        <Text style={{ color: colors.label, fontSize: 15, fontWeight: "700" }}>
          {Math.round(progress * 100)}%
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.label, fontSize: 28, fontWeight: "700" }}>
          {collected}
          <Text style={{ color: colors.secondaryLabel, fontSize: 20, fontWeight: "600" }}>
            {` / ${total}`}
          </Text>
        </Text>
        <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>
          {t("diaryCompaniesCollected")}
        </Text>
      </View>
    </View>
  );
}

/** A round sticker: the logo on white, or a locked silhouette until collected. */
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
          // in dark mode too. An empty slot is a dashed outline.
          backgroundColor: collected ? "#ffffff" : colors.surface,
          borderColor: collected ? colors.separator : colors.tertiaryLabel,
          borderRadius: size / 2,
          borderStyle: collected ? "solid" : "dashed",
          borderWidth: collected ? 1 : 1.5,
          boxShadow: collected ? "0 3px 10px rgba(0,0,0,0.14)" : undefined,
          height: size,
          justifyContent: "center",
          overflow: "hidden",
          width: size,
        }}
      >
        {logo ? (
          <Image
            accessible={false}
            source={{ uri: logo }}
            resizeMode="contain"
            // Uncollected logos render as a flat silhouette of their shape.
            tintColor={collected ? undefined : (colors.tertiaryLabel as string)}
            style={{
              height: size * 0.62,
              opacity: collected ? 1 : 0.55,
              width: size * 0.62,
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
      </View>
      {collected && item.entry?.starred ? (
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderRadius: 13,
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
      {collected ? null : (
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderRadius: 12,
            bottom: 0,
            height: 24,
            justifyContent: "center",
            position: "absolute",
            right: 0,
            width: 24,
          }}
        >
          <SymbolView
            accessible={false}
            name="lock.fill"
            size={12}
            tintColor={colors.secondaryLabel}
          />
        </View>
      )}
    </View>
  );
}

function CompanyBadge({
  item,
  size,
  celebrate,
  onOpen,
}: {
  item: SponsorCollectionItem;
  size: number;
  celebrate: boolean;
  onOpen: () => void;
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
        <Animated.View style={{ transform: [{ scale }] }}>
          <Medallion item={item} size={size} collected={collected} />
        </Animated.View>
      </View>
      <Text
        numberOfLines={2}
        style={{
          color: collected ? colors.label : colors.tertiaryLabel,
          fontSize: 13,
          fontWeight: collected ? "600" : "500",
          lineHeight: 16,
          textAlign: "center",
        }}
      >
        {item.name}
      </Text>
    </View>
  );

  if (!collected) {
    return (
      <View accessible accessibilityLabel={t("diaryCompanyLocked", { name: item.name })}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.name}
      onPress={onOpen}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

/** One collected company: not a person profile, a compact stand card. */
export function CompanySheet({
  item,
  busy,
  onClose,
  onToggleStar,
  onEditNote,
  onRemove,
}: {
  item: SponsorCollectionItem | null;
  busy: boolean;
  onClose: () => void;
  onToggleStar: () => void;
  onEditNote: () => void;
  onRemove: () => void;
}) {
  const { t, language } = useLocale();
  const insets = useSafeAreaInsets();
  const entry = item?.entry ?? null;
  const collectedOn = entry
    ? new Date(entry.createdAt).toLocaleDateString(language, { day: "numeric", month: "long" })
    : null;
  return (
    <Modal
      visible={item !== null && entry !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {item && entry ? (
        <View style={{ backgroundColor: colors.background, flex: 1 }}>
          <View
            style={{
              alignItems: "flex-end",
              paddingHorizontal: 12,
              paddingTop: process.env.EXPO_OS === "android" ? insets.top + 8 : 12,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("close")}
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => ({
                alignItems: "center",
                backgroundColor: colors.surface,
                borderRadius: 16,
                height: 32,
                justifyContent: "center",
                opacity: pressed ? 0.6 : 1,
                width: 32,
              })}
            >
              <SymbolView
                accessible={false}
                name="xmark"
                size={13}
                weight="bold"
                tintColor={colors.secondaryLabel}
              />
            </Pressable>
          </View>
          <ScrollView
            testID="company-sheet"
            contentContainerStyle={{
              gap: 24,
              paddingBottom: Math.max(32, insets.bottom + 16),
              paddingHorizontal: 16,
            }}
          >
            <View style={{ alignItems: "center", gap: 12 }}>
              <Medallion item={item} size={112} collected />
              <View style={{ alignItems: "center", gap: 4 }}>
                <Text
                  accessibilityRole="header"
                  style={{
                    color: colors.label,
                    fontSize: 26,
                    fontWeight: "700",
                    textAlign: "center",
                  }}
                >
                  {item.name}
                </Text>
                {collectedOn ? (
                  <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>
                    {t("diaryCompanyCollectedOn", { date: collectedOn })}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <QuickAction
                icon={entry.starred ? "star.fill" : "star"}
                iconTint={entry.starred ? colors.warning : colors.accent}
                label={t(entry.starred ? "diaryUnfavourite" : "diaryFavourite")}
                title={t("diaryFavourite")}
                selected={entry.starred}
                busy={busy}
                onPress={onToggleStar}
                iconNode={<FavouriteStar on={entry.starred} size={22} />}
              />
              <QuickAction
                icon="note.text"
                label={t("diaryNote")}
                title={t("diaryNote")}
                busy={false}
                onPress={onEditNote}
              />
              {item.website ? (
                <QuickAction
                  icon="globe"
                  label={`${t("directoryWebsite")}, ${displayUrl(item.website)}`}
                  title={t("directoryWebsite")}
                  busy={false}
                  onPress={() => void Linking.openURL(item.website as string)}
                />
              ) : null}
            </View>

            {item.description ? (
              <Section>
                <Text
                  selectable
                  style={{
                    color: colors.label,
                    fontSize: 16,
                    lineHeight: 23,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                  }}
                >
                  {item.description}
                </Text>
              </Section>
            ) : null}

            {entry.note ? (
              <Section title={t("diaryNote")}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint={t("diaryNote")}
                  onPress={onEditNote}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? colors.elevatedSurface : undefined,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                  })}
                >
                  <Text selectable style={{ color: colors.label, fontSize: 16, lineHeight: 22 }}>
                    {entry.note}
                  </Text>
                </Pressable>
              </Section>
            ) : null}

            {item.challenges.length > 0 ? (
              <Section title={t("directoryChallenges")}>
                {item.challenges.map((challenge, index) => (
                  <View key={challenge.id}>
                    {index > 0 ? <Separator inset={ROW_ICON_INSET} /> : null}
                    <DetailRow icon="trophy" value={challenge.name} />
                  </View>
                ))}
              </Section>
            ) : null}

            <Section>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={onRemove}
                style={({ pressed }) => ({
                  alignItems: "center",
                  backgroundColor: pressed ? colors.elevatedSurface : undefined,
                  justifyContent: "center",
                  minHeight: 50,
                  paddingHorizontal: 16,
                })}
              >
                <Text style={{ color: colors.destructive, fontSize: 16 }}>
                  {t("diaryCompanyRemove")}
                </Text>
              </Pressable>
            </Section>
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}
