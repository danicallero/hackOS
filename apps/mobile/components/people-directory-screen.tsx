import { MenuView } from "@expo/ui/community/menu";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { EmptyState, Separator } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import { emitManualActivityScan } from "@/lib/manual-activity-scan";
import { listScannerPeople } from "@/lib/scanner-db";
import type { ScannerPerson } from "@/lib/scanner-types";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

export function PeopleDirectoryScreen() {
  const { activityId } = useLocalSearchParams<{ activityId?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useLocale();
  const sync = useScannerSync();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | ScannerPerson["role"]>("all");
  const [people, setPeople] = useState<ScannerPerson[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => setPeople(await listScannerPeople()), []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (sync.lastSync) void load();
  }, [load, sync.lastSync]);
  // Badge assignments/removals happen on the person detail screen, a
  // separate mounted instance with its own sync state — reload from SQLite
  // whenever this list regains focus so a just-applied change isn't stuck
  // showing stale data until this screen's own 15s sync tick catches up.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await sync.sync();
    await load();
    setRefreshing(false);
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      title: activityId ? t("scannerSearchPerson") : t("scannerPeople"),
      headerLargeTitle: true,
      headerSearchBarOptions: {
        placeholder: t("scannerPeopleSearchPlaceholder"),
        autoCapitalize: "none",
        onChangeText: (event: { nativeEvent: { text: string } }) =>
          setQuery(event.nativeEvent.text),
      },
      headerRight: () => (
        <MenuView
          actions={ROLE_FILTERS.map((filter) => ({
            id: filter.value,
            title: t(filter.labelKey),
            image: filter.icon,
            state: roleFilter === filter.value ? "on" : "off",
          }))}
          onPressAction={({ nativeEvent }) => setRoleFilter(nativeEvent.event as typeof roleFilter)}
        >
          <SymbolView
            name={
              roleFilter === "all"
                ? "line.3.horizontal.decrease"
                : "line.3.horizontal.decrease.circle.fill"
            }
            tintColor={colors.accent}
            size={19}
          />
        </MenuView>
      ),
    });
  }, [activityId, navigation, roleFilter, t]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return people.filter((person) => {
      // An activity scan can only ever be logged against a badge, so this
      // list (unlike the plain scan directory, which lists everyone) only
      // shows people who already have one.
      if (activityId && !person.badgeId) return false;
      if (roleFilter !== "all" && person.role !== roleFilter) return false;
      if (!needle) return true;
      return [person.name, person.surname, person.email, person.badgeId, roleLabel(person.role, t)]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [people, query, roleFilter, activityId, t]);

  function openPerson(person: ScannerPerson) {
    if (activityId) {
      // Guaranteed by the `filtered` list above.
      emitManualActivityScan(Number(activityId), person.badgeId!);
      router.back();
      return;
    }
    router.push({
      pathname: "/(tabs)/scan/person/[id]",
      params: { id: String(person.userId) },
    });
  }

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 32 }}
      data={filtered}
      keyExtractor={(person) => String(person.userId)}
      ItemSeparatorComponent={() => <Separator inset={72} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
      ListEmptyComponent={
        <EmptyState
          icon="person.2"
          title={query ? t("scannerNoResults") : t("scannerNoSyncedUsers")}
          description={query ? t("scannerTryAnotherSearch") : t("scannerRefreshDirectory")}
        />
      }
      renderItem={({ item }) => <PersonRow person={item} onPress={() => openPerson(item)} />}
    />
  );
}

const ROLE_FILTERS: Array<{
  value: "all" | ScannerPerson["role"];
  labelKey:
    | "roleAll"
    | "roleAdmin"
    | "roleJudge"
    | "roleSponsor"
    | "roleStaff"
    | "roleParticipants";
  icon:
    | "person.2"
    | "person.crop.circle.badge.checkmark"
    | "checkmark.seal"
    | "briefcase"
    | "person";
}> = [
  { value: "all", labelKey: "roleAll", icon: "person.2" },
  { value: "admin", labelKey: "roleAdmin", icon: "person.crop.circle.badge.checkmark" },
  { value: "judge", labelKey: "roleJudge", icon: "checkmark.seal" },
  { value: "sponsor", labelKey: "roleSponsor", icon: "briefcase" },
  { value: "staff", labelKey: "roleStaff", icon: "person.crop.circle.badge.checkmark" },
  { value: "participant", labelKey: "roleParticipants", icon: "person" },
];

function PersonRow({ person, onPress }: { person: ScannerPerson; onPress: () => void }) {
  const { t } = useLocale();
  const fullName = [person.name, person.surname].filter(Boolean).join(" ");
  const displayName = fullName || person.email;
  // Only shown as its own line when it isn't already standing in for the
  // name above (someone with no name on file at all).
  const showEmailLine = Boolean(fullName) && Boolean(person.email);
  const participantWarning =
    person.role === "participant" && !person.accepted
      ? { label: t("scannerNoAcceptedPlace"), tone: "destructive" as const }
      : person.role === "participant" && !person.confirmed
        ? { label: t("scannerPlaceUnconfirmed"), tone: "warning" as const }
        : null;

  return (
    <Pressable
      accessibilityHint={t("scannerViewPerson")}
      accessibilityLabel={[
        displayName,
        showEmailLine ? person.email : null,
        roleLabel(person.role, t),
        person.badgeId ?? t("scannerNoBadge"),
      ]
        .filter(Boolean)
        .join(", ")}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? colors.elevatedSurface : colors.background,
        flexDirection: "row",
        gap: 12,
        minHeight: participantWarning ? 98 : 84,
        paddingHorizontal: 16,
        paddingVertical: 9,
      })}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.accentSurface,
          borderRadius: 999,
          height: 40,
          justifyContent: "center",
          width: 40,
        }}
      >
        <SymbolView name="person.fill" tintColor={colors.accent} size={18} accessible={false} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          selectable
          style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}
        >
          {displayName}
        </Text>
        {showEmailLine ? (
          <Text
            numberOfLines={1}
            selectable
            style={{ color: colors.tertiaryLabel, fontSize: 13, fontWeight: "400" }}
          >
            {person.email}
          </Text>
        ) : null}
        <Text numberOfLines={1} selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>
          {roleLabel(person.role, t)} · {person.badgeId ?? t("scannerNoBadge")}
        </Text>
        {participantWarning ? (
          <View style={{ alignItems: "center", flexDirection: "row", gap: 5 }}>
            <SymbolView
              name="exclamationmark.circle.fill"
              tintColor={colors.destructive}
              size={13}
              accessible={false}
            />
            <Text
              numberOfLines={1}
              selectable
              style={{ color: colors.destructive, fontSize: 13, fontWeight: "600" }}
            >
              {participantWarning.label}
            </Text>
          </View>
        ) : null}
      </View>
      <SymbolView name="chevron.right" tintColor={colors.tertiaryLabel} size={14} />
    </Pressable>
  );
}

function roleLabel(role: ScannerPerson["role"], t: ReturnType<typeof useLocale>["t"]) {
  return (
    {
      admin: t("roleAdmin"),
      judge: t("roleJudge"),
      sponsor: t("roleSponsor"),
      staff: t("roleStaff"),
      participant: t("roleParticipant"),
    } as const
  )[role];
}
