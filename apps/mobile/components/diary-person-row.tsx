import { MenuView } from "@expo/ui/community/menu";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { FavouriteStar } from "@/components/favourite-star";
import { MenuTriggerIcon } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

export const PERSON_ROW_TEXT_INSET = 76;
/** Star + menu, or the Save pill; a row with only the menu needs one target. */
const TRAILING_WIDTH = 92;
const MENU_ONLY_WIDTH = 44;

/**
 * One person in Saved or Directory (#935): the same layout either way. The
 * whole row opens the profile with a full-width pressed state; trailing
 * controls are siblings layered on top, so pressing them never also opens
 * the profile (a native menu inside a Pressable would bubble its tap).
 *
 * Saving and favouriting are separate: an unsaved person offers Save; a
 * saved one offers the favourite star and a menu with the note and an
 * explicit "Remove from diary".
 */
export function DiaryPersonRow({
  name,
  photoUrl,
  headline,
  detail,
  detailIsNote = false,
  saved,
  starred,
  busy,
  available = true,
  onOpen,
  onSave,
  onToggleStar,
  onEditNote,
  onRemove,
  testID,
}: {
  name: string;
  photoUrl: string | null;
  headline?: string | null;
  detail?: string | null;
  detailIsNote?: boolean;
  saved: boolean;
  starred: boolean;
  busy: boolean;
  available?: boolean;
  onOpen?: () => void;
  onSave?: () => void;
  onToggleStar?: () => void;
  onEditNote?: () => void;
  onRemove?: () => void;
  testID?: string;
}) {
  const { t } = useLocale();
  const lines = [headline, detail].filter(Boolean) as string[];
  const trailingWidth = saved ? (onToggleStar ? TRAILING_WIDTH : MENU_ONLY_WIDTH) : TRAILING_WIDTH;
  const body = (
    <>
      <PersonAvatar size={48} name={available ? name : null} uri={photoUrl} />
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            color: available ? colors.label : colors.secondaryLabel,
            fontSize: 17,
            fontWeight: available ? "600" : "400",
          }}
        >
          {name}
        </Text>
        {headline ? (
          <Text numberOfLines={1} style={{ color: colors.secondaryLabel, fontSize: 14 }}>
            {headline}
          </Text>
        ) : null}
        {detail ? (
          <Text
            // The owner's own note gets a second line; a project name stays on one.
            numberOfLines={detailIsNote ? 2 : 1}
            style={{
              color: detailIsNote ? colors.label : colors.secondaryLabel,
              fontSize: 14,
              fontStyle: detailIsNote ? "italic" : "normal",
            }}
          >
            {detail}
          </Text>
        ) : null}
      </View>
    </>
  );
  const rowStyle = {
    alignItems: "center" as const,
    flexDirection: "row" as const,
    gap: 12,
    minHeight: 72,
    paddingLeft: 16,
    paddingRight: trailingWidth + 4,
    paddingVertical: 10,
  };

  return (
    <View testID={testID} style={{ position: "relative" }}>
      {onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[name, ...lines].join(", ")}
          onPress={onOpen}
          style={({ pressed }) => [
            rowStyle,
            { backgroundColor: pressed ? colors.elevatedSurface : undefined },
          ]}
        >
          {body}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={name} style={rowStyle}>
          {body}
        </View>
      )}
      <View
        pointerEvents="box-none"
        style={{
          alignItems: "center",
          bottom: 0,
          flexDirection: "row",
          justifyContent: "flex-end",
          position: "absolute",
          right: 6,
          top: 0,
          width: trailingWidth,
        }}
      >
        {saved ? (
          <>
            {onToggleStar ? (
              <Pressable
                key="star"
                accessibilityRole="button"
                accessibilityLabel={`${t(starred ? "diaryUnfavourite" : "diaryFavourite")}, ${name}`}
                accessibilityState={{ disabled: busy, selected: starred }}
                disabled={busy}
                hitSlop={4}
                onPress={onToggleStar}
                style={({ pressed }) => ({
                  alignItems: "center",
                  height: 44,
                  justifyContent: "center",
                  opacity: busy ? 0.45 : pressed ? 0.6 : 1,
                  width: 44,
                })}
              >
                <FavouriteStar on={starred} />
              </Pressable>
            ) : null}
            <MenuView
              shouldOpenOnLongPress={false}
              actions={[
                ...(onEditNote
                  ? [
                      {
                        id: "note",
                        title: t("diaryNote"),
                        image: "pencil" as const,
                        attributes: { disabled: busy },
                      },
                    ]
                  : []),
                {
                  id: "remove",
                  title: t("diaryRemoveFromDiary"),
                  image: "trash" as const,
                  attributes: { destructive: true, disabled: busy },
                },
              ]}
              onPressAction={({ nativeEvent }) => {
                if (busy) return;
                if (nativeEvent.event === "note") onEditNote?.();
                if (nativeEvent.event === "remove") onRemove?.();
              }}
            >
              <MenuTriggerIcon
                icon="ellipsis"
                accessibilityLabel={`${t("diaryEntryOptions")}, ${name}`}
                tintColor={colors.accent}
                disabled={busy}
                iconSize={18}
                weight="regular"
              />
            </MenuView>
          </>
        ) : onSave ? (
          // Keyed apart from the star that replaces it: reusing the native view
          // left Android announcing the star as "busy" after a save.
          <Pressable
            key="save"
            accessibilityRole="button"
            accessibilityLabel={`${t("directorySave")}, ${name}`}
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={onSave}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: colors.accentSurface,
              borderCurve: "continuous",
              borderRadius: 16,
              flexDirection: "row",
              gap: 4,
              height: 32,
              justifyContent: "center",
              marginRight: 6,
              opacity: pressed ? 0.7 : 1,
              paddingHorizontal: 12,
            })}
          >
            {busy ? (
              <ActivityIndicator color={colors.onAccentSurface} />
            ) : (
              <>
                <SymbolView
                  accessible={false}
                  name="plus"
                  size={13}
                  weight="bold"
                  tintColor={colors.onAccentSurface}
                />
                <Text style={{ color: colors.onAccentSurface, fontSize: 15, fontWeight: "600" }}>
                  {t("save")}
                </Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
