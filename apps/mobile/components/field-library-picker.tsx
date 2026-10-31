import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SheetModal } from "@/components/app-sheet";
import { FloatingGlassButton, Separator } from "@/components/native-ui";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";
import { RowButton } from "./project-ui";
import { SymbolView } from "./symbol";

/**
 * H11/H16: one question catalogue, unlimited proposals and selections. The
 * field shows its selection as one row; choosing opens a sheet with search, so
 * a long catalogue never stretches the form.
 */
export function FieldLibraryPicker({
  libraryId,
  title,
  value,
  onChange,
  disabled,
}: {
  libraryId?: string;
  title?: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ id: number; name: string }[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly repeats the catalogue request.
  useEffect(() => {
    if (!libraryId) return;
    const controller = new AbortController();
    apiFetch<{ items: { id: number; name: string }[] }>(`/api/form-libraries/${libraryId}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setItems(data.items);
        setError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [libraryId, retry]);
  const names = [...new Set([...items.map((item) => item.name), ...value])].filter((name) =>
    name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  async function propose() {
    if (!libraryId || !query.trim()) return;
    setBusy(true);
    setError(false);
    try {
      const item = await apiFetch<{ id: number; name: string }>(
        `/api/form-libraries/${libraryId}/proposals`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: query.trim() }),
        },
      );
      setItems((items) => [...items.filter((entry) => entry.id !== item.id), item]);
      onChange([...new Set([...value, item.name])]);
      setQuery("");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const heading = title ?? t("fieldLibrarySearch");
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={heading}
        disabled={disabled}
        onPress={() => setOpen(true)}
        hitSlop={{ top: 8, bottom: 8 }}
        style={({ pressed }) => ({
          alignItems: "center",
          flexDirection: "row",
          gap: 12,
          minHeight: 28,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text
          numberOfLines={2}
          style={{
            color: value.length ? colors.label : colors.tertiaryLabel,
            flex: 1,
            fontSize: 17,
          }}
        >
          {value.length ? value.join(", ") : t("fieldLibrarySearch")}
        </Text>
        {disabled ? null : (
          <SymbolView
            name="chevron.right"
            tintColor={colors.tertiaryLabel}
            size={12}
            weight="semibold"
            accessible={false}
          />
        )}
      </Pressable>
      <SheetModal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ backgroundColor: colors.background, flex: 1 }}>
          <ScrollView
            alwaysBounceVertical
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              gap: 16,
              padding: 16,
              paddingBottom: 32,
              paddingTop: 76,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{ color: colors.label, fontSize: 28, fontWeight: "700" }}
            >
              {heading}
            </Text>
            <TextInput
              accessibilityLabel={t("fieldLibrarySearch")}
              placeholder={t("fieldLibrarySearch")}
              placeholderTextColor={colors.tertiaryLabel}
              value={query}
              onChangeText={setQuery}
              editable={!disabled && !busy}
              autoCapitalize="none"
              style={{
                backgroundColor: colors.surface,
                borderRadius: 14,
                color: colors.label,
                fontSize: 17,
                minHeight: 44,
                paddingHorizontal: 16,
              }}
            />
            {names.length > 0 ? (
              <View
                style={{
                  backgroundColor: colors.surface,
                  borderCurve: "continuous",
                  borderRadius: 14,
                  overflow: "hidden",
                }}
              >
                {names.map((name, index) => (
                  <View key={name}>
                    {index > 0 ? <Separator /> : null}
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel={name}
                      accessibilityState={{
                        checked: value.includes(name),
                        disabled: disabled || busy,
                      }}
                      disabled={disabled || busy}
                      onPress={() =>
                        onChange(
                          value.includes(name)
                            ? value.filter((entry) => entry !== name)
                            : [...value, name],
                        )
                      }
                      style={{
                        alignItems: "center",
                        flexDirection: "row",
                        gap: 12,
                        minHeight: 50,
                        paddingHorizontal: 16,
                      }}
                    >
                      <Text style={{ color: colors.label, flex: 1, fontSize: 17 }}>{name}</Text>
                      {value.includes(name) && (
                        <SymbolView
                          name="checkmark"
                          tintColor={colors.accent}
                          size={18}
                          accessible={false}
                        />
                      )}
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
            {query.trim() &&
              !items.some(
                (item) => item.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
              ) && (
                <RowButton
                  label={t("fieldLibraryAdd", { name: query.trim() })}
                  disabled={disabled || busy}
                  onPress={() => void propose()}
                />
              )}
            {error && (
              <RowButton
                label={t("fieldLibraryRetry")}
                onPress={() => {
                  setError(false);
                  setRetry((value) => value + 1);
                }}
              />
            )}
          </ScrollView>
          <FloatingGlassButton
            top={16}
            side="right"
            icon="checkmark"
            accessibilityLabel={t("close")}
            onPress={() => setOpen(false)}
          />
        </View>
      </SheetModal>
    </>
  );
}
