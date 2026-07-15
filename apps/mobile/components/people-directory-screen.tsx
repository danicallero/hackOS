import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";

import { EmptyState, StatusPill } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import { emitManualActivityScan } from "@/lib/manual-activity-scan";
import { listScannerPeople } from "@/lib/scanner-db";
import type { ScannerPerson } from "@/lib/scanner-types";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

export function PeopleDirectoryScreen() {
  const { activityId } = useLocalSearchParams<{ activityId?: string }>();
  const router = useRouter();
  const { t } = useLocale();
  const sync = useScannerSync();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | ScannerPerson["role"]>("all");
  const [people, setPeople] = useState<ScannerPerson[]>([]);

  const load = useCallback(async () => setPeople(await listScannerPeople()), []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (sync.lastSync) void load();
  }, [load, sync.lastSync]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return people.filter((person) => {
      if (roleFilter !== "all" && person.role !== roleFilter) return false;
      if (!needle) return true;
      return [person.name, person.surname, person.email, person.badgeId, roleLabel(person.role, t)]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [people, query, roleFilter, t]);

  function openPerson(person: ScannerPerson) {
    if (activityId) {
      if (!person.badgeId) {
        Alert.alert(t("scannerNoBadge"), t("scannerNoBadgeActivityBody"), [
          { text: t("cancel"), style: "cancel" },
          {
            text: t("scannerViewPerson"),
            onPress: () =>
              router.push({
                pathname: "/(tabs)/others/activities/person/[id]",
                params: { id: String(person.userId) },
              }),
          },
        ]);
        return;
      }
      emitManualActivityScan(Number(activityId), person.badgeId);
      router.back();
      return;
    }
    router.push({
      pathname: "/(tabs)/others/scan/person/[id]",
      params: { id: String(person.userId) },
    });
  }

  return (
    <>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 32 }}
        data={filtered}
        keyExtractor={(person) => String(person.userId)}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <EmptyState
            icon="person.2"
            title={query ? t("scannerNoResults") : t("scannerNoSyncedUsers")}
            description={query ? t("scannerTryAnotherSearch") : t("scannerRefreshDirectory")}
          />
        }
        renderItem={({ item }) => <PersonRow person={item} onPress={() => openPerson(item)} />}
      />
      <Stack.Title>{activityId ? t("scannerSearchPerson") : t("scannerPeople")}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="chevron.left" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="line.3.horizontal.decrease">
          {ROLE_FILTERS.map((filter) => (
            <Stack.Toolbar.MenuAction
              icon={filter.icon}
              isOn={roleFilter === filter.value}
              key={filter.value}
              onPress={() => setRoleFilter(filter.value)}
            >
              {t(filter.labelKey)}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <Stack.SearchBar
        placeholder={t("scannerPeopleSearchPlaceholder")}
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        onCancelButtonPress={() => setQuery("")}
      />
    </>
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
  const name = [person.name, person.surname].filter(Boolean).join(" ") || person.email;
  const participantWarning =
    person.role === "participant" && !person.accepted
      ? { label: t("scannerNoAcceptedPlace"), tone: "destructive" as const }
      : person.role === "participant" && !person.confirmed
        ? { label: t("scannerPlaceUnconfirmed"), tone: "warning" as const }
        : null;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.surface,
        borderCurve: "continuous",
        borderRadius: 16,
        flexDirection: "row",
        gap: 12,
        minHeight: 76,
        opacity: pressed ? 0.65 : 1,
        padding: 14,
      })}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.accentSurface,
          borderRadius: 999,
          height: 44,
          justifyContent: "center",
          width: 44,
        }}
      >
        <SymbolView name="person.fill" tintColor={colors.accent} size={20} />
      </View>
      <View style={{ flex: 1, gap: 5 }}>
        <Text selectable style={{ color: colors.label, fontSize: 16, fontWeight: "700" }}>
          {name}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <StatusPill>{roleLabel(person.role, t)}</StatusPill>
          <StatusPill tone={person.badgeId ? "success" : "neutral"}>
            {person.badgeId ?? t("scannerNoBadge")}
          </StatusPill>
          {participantWarning ? (
            <StatusPill tone={participantWarning.tone}>{participantWarning.label}</StatusPill>
          ) : null}
        </View>
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
