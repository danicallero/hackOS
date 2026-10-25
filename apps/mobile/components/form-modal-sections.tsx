import type { ReactNode, Ref } from "react";
import { Pressable, ScrollView, Text, TextInput, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveFrame } from "@/components/adaptive-frame";
import { SheetModal } from "@/components/app-sheet";
import { FloatingGlassButton, Section } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { colors, radius, type } from "@/theme";

export function FormModalShell({
  children,
  onClose,
  onSave,
  pending,
  scrollRef,
  title,
  visible,
}: {
  children: ReactNode;
  onClose: () => void;
  onSave: () => void;
  pending: boolean;
  scrollRef?: Ref<ScrollView>;
  title: string;
  visible: boolean;
}) {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();

  return (
    <SheetModal animationType="slide" onRequestClose={onClose} visible={visible}>
      <AdaptiveFrame>
        <ScrollView
          alwaysBounceVertical
          ref={scrollRef}
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{
            gap: 22,
            padding: 16,
            paddingBottom: Math.max(32, insets.bottom + 16),
            paddingTop: 16,
          }}
        >
          <View style={{ justifyContent: "center", minHeight: 44, paddingHorizontal: 52 }}>
            <Text
              selectable
              style={{
                color: colors.label,
                fontSize: type.title3.fontSize,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              {title}
            </Text>
          </View>
          {children}
        </ScrollView>

        <FloatingGlassButton
          top={16}
          side="left"
          icon="xmark"
          accessibilityLabel={t("cancel")}
          onPress={onClose}
        />
        <FloatingGlassButton
          top={16}
          side="right"
          icon="checkmark"
          tintColor={colors.accent}
          accessibilityLabel={t("save")}
          accessibilityState={{ busy: pending }}
          disabled={pending}
          onPress={onSave}
        />
      </AdaptiveFrame>
    </SheetModal>
  );
}

export function FormModalTranslationsDisclosure({
  children,
  expanded,
  onToggle,
  onTranslate,
  translateAccessibilityState,
  translateAvailable,
  translateButtonStyle,
  translateDisabled,
  translating,
}: {
  children: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  onTranslate: () => void;
  translateAccessibilityState?: { busy?: boolean; disabled?: boolean };
  translateAvailable: boolean;
  translateButtonStyle?: Pick<ViewStyle, "minHeight" | "paddingHorizontal" | "paddingVertical">;
  translateDisabled: boolean;
  translating: boolean;
}) {
  const { t } = useLocale();

  return (
    <View style={{ gap: 8 }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
        <PressableFeedback
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel={t("translationsAndSettings")}
          accessibilityState={{ expanded }}
          hitSlop={8}
          onPress={onToggle}
          style={{
            alignItems: "center",
            flex: 1,
            flexDirection: "row",
            gap: 6,
            paddingVertical: 8,
          }}
        >
          <SymbolView
            name="chevron.right"
            tintColor={colors.secondaryLabel}
            size={13}
            weight="semibold"
            style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}
          />
          <Text
            style={{
              color: colors.secondaryLabel,
              fontSize: type.footnote.fontSize,
              fontWeight: "600",
            }}
          >
            {t("translationsAndSettings")}
          </Text>
        </PressableFeedback>
        {translateAvailable ? (
          <PressableFeedback
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel={t("translateAutomatically")}
            accessibilityState={translateAccessibilityState}
            disabled={translateDisabled}
            onPress={onTranslate}
            style={{
              alignItems: "center",
              backgroundColor: colors.elevatedSurface,
              borderCurve: "continuous",
              borderRadius: radius.chip,
              flexDirection: "row",
              gap: 8,
              ...translateButtonStyle,
            }}
          >
            <SymbolView
              name="character.book.closed"
              tintColor={colors.accent}
              size={16}
              accessible={false}
            />
            <Text
              style={{
                color: colors.accent,
                fontSize: type.subhead.fontSize,
                fontWeight: "600",
              }}
            >
              {translating ? t("translatingInProgress") : t("translateAutomatically")}
            </Text>
          </PressableFeedback>
        ) : null}
      </View>
      {expanded ? children : null}
    </View>
  );
}

export type FormModalPersonCandidate = {
  id: number;
  email: string;
  name: string | null;
  surname: string | null;
};

function personCandidateName(candidate: FormModalPersonCandidate): string {
  return [candidate.name, candidate.surname].filter(Boolean).join(" ").trim() || candidate.email;
}

export function FormModalPeoplePicker<T extends FormModalPersonCandidate>({
  accessibilityLabel,
  candidates,
  children,
  editable,
  emptyResultsLabel,
  onChangeQuery,
  onClear,
  onSearch,
  query,
  renderCandidateAction,
  searchError,
  searching,
  searched,
  title,
}: {
  accessibilityLabel: string;
  candidates: T[];
  children: ReactNode;
  editable: boolean;
  emptyResultsLabel: string;
  onChangeQuery: (value: string) => void;
  onClear: () => void;
  onSearch: () => void;
  query: string;
  renderCandidateAction: (candidate: T) => ReactNode;
  searchError: Error | null;
  searching: boolean;
  searched: boolean;
  title: string;
}) {
  const { t } = useLocale();

  return (
    <Section title={title}>
      <View style={{ gap: 8, padding: 16 }}>
        <View
          accessible
          accessibilityLabel={accessibilityLabel}
          style={{
            alignItems: "center",
            backgroundColor: colors.elevatedSurface,
            borderCurve: "continuous",
            borderRadius: radius.chip,
            flexDirection: "row",
            gap: 8,
            minHeight: 36,
            paddingHorizontal: 8,
          }}
        >
          <SymbolView
            name="magnifyingglass"
            tintColor={colors.tertiaryLabel}
            size={15}
            accessible={false}
          />
          <TextInput
            accessibilityLabel={accessibilityLabel}
            editable={editable}
            onChangeText={onChangeQuery}
            onSubmitEditing={onSearch}
            placeholder={accessibilityLabel}
            placeholderTextColor={colors.tertiaryLabel}
            returnKeyType="search"
            value={query}
            style={{ color: colors.label, flex: 1, fontSize: type.body.fontSize, minHeight: 36 }}
          />
          {query.length > 0 ? (
            <Pressable accessibilityLabel={t("cancel")} onPress={onClear} hitSlop={8}>
              <SymbolView
                name="xmark.circle.fill"
                tintColor={colors.tertiaryLabel}
                size={16}
                accessible={false}
              />
            </Pressable>
          ) : null}
        </View>
        {searchError ? (
          <RequestFeedback error={searchError} onRetry={onSearch} retrying={searching} />
        ) : null}
      </View>
      {candidates.map((candidate) => (
        <View key={candidate.id}>
          <View style={{ backgroundColor: colors.separator, height: 0.5, marginLeft: 16 }} />
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: 12,
              minHeight: 44,
              paddingHorizontal: 16,
              paddingVertical: 6,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                selectable
                numberOfLines={1}
                style={{ color: colors.label, fontSize: type.callout.fontSize }}
              >
                {personCandidateName(candidate)}
              </Text>
              <Text
                selectable
                numberOfLines={1}
                style={{ color: colors.secondaryLabel, fontSize: type.compact.fontSize }}
              >
                {candidate.email}
              </Text>
            </View>
            {renderCandidateAction(candidate)}
          </View>
        </View>
      ))}
      {!searching && searched && candidates.length === 0 ? (
        <View style={{ borderTopColor: colors.separator, borderTopWidth: 0.5, padding: 16 }}>
          <Text style={{ color: colors.tertiaryLabel, fontSize: type.compact.fontSize }}>
            {emptyResultsLabel}
          </Text>
        </View>
      ) : null}
      {children}
    </Section>
  );
}
