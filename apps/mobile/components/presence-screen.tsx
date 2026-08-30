import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PresenceManagement } from "@/components/presence-management";
import { transparentDetailHeaderOptions } from "@/lib/navigation";
import { findPersonById } from "@/lib/scanner-db";
import { colors } from "@/theme/colors";

const CONTENT_PADDING = 16;
// Android has no automatic content inset for a transparent native header, so
// the title has to clear the status bar and native header on its own.
const ANDROID_HEADER_CLEARANCE = 68;

export function PresenceScreen() {
  const { id, draftKind, draftAt, focusLogId, focusSource } = useLocalSearchParams<{
    id: string;
    draftKind?: string;
    draftAt?: string;
    focusLogId?: string;
    focusSource?: string;
  }>();
  const userId = Number(id);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [personName, setPersonName] = useState<string | null>(null);
  const [personBadgeId, setPersonBadgeId] = useState<string | null>(null);
  const draftKindValid: "in" | "out" | null =
    draftKind === "in" || draftKind === "out" ? draftKind : null;
  const initialDraft = draftKindValid
    ? { kind: draftKindValid, occurredAt: draftAt ? new Date(draftAt) : new Date() }
    : undefined;
  const focusLogIdNumber = focusLogId ? Number(focusLogId) : NaN;
  const focusSignal: { id: number; source: "door" | "activity" } | undefined =
    Number.isInteger(focusLogIdNumber) && focusLogIdNumber > 0
      ? focusSource === "door"
        ? { id: focusLogIdNumber, source: "door" }
        : focusSource === "activity"
          ? { id: focusLogIdNumber, source: "activity" }
          : undefined
      : undefined;

  // Presence is reachable from several stacks. Keep the native navigation
  // chrome transparent and title-less in each one, leaving only its back
  // action visible.
  useLayoutEffect(() => {
    navigation.setOptions(transparentDetailHeaderOptions);
  }, [navigation]);

  useEffect(() => {
    let active = true;
    void findPersonById(userId).then((person) => {
      if (!active || !person) return;
      setPersonName([person.name, person.surname].filter(Boolean).join(" ") || person.email);
      setPersonBadgeId(person.badgeId);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        gap: 22,
        paddingBottom: 40,
        paddingHorizontal: CONTENT_PADDING,
        // On iOS the transparent native header is handled by `automatic`;
        // adding `insets.top` again would double-count the safe area.
        paddingTop: process.env.EXPO_OS === "ios" ? 0 : insets.top + ANDROID_HEADER_CLEARANCE,
      }}
      style={{ backgroundColor: colors.background }}
    >
      {personName ? (
        <Text
          selectable
          accessibilityRole="header"
          style={{ color: colors.label, fontSize: 28, fontWeight: "800" }}
        >
          {personName}
        </Text>
      ) : null}

      {/* This subpage always shows the summary + timeline, unlike the
            compact link on the profile which hides for an unaccredited
            person with no signals yet — reaching here already implies
            there's something to look at. */}
      <PresenceManagement
        accredited
        badgeId={personBadgeId}
        focusSignal={focusSignal}
        initialDraft={initialDraft}
        userId={userId}
      />
    </ScrollView>
  );
}
