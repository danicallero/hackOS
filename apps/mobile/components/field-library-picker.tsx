import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";
import { RowButton } from "./project-ui";
import { SymbolView } from "./symbol";

/** H11/H16: one question catalogue, unlimited proposals and selections. */
export function FieldLibraryPicker({
  libraryId,
  value,
  onChange,
  disabled,
}: {
  libraryId?: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
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
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        accessibilityLabel={t("fieldLibrarySearch")}
        placeholder={t("fieldLibrarySearch")}
        placeholderTextColor={colors.tertiaryLabel}
        value={query}
        onChangeText={setQuery}
        editable={!disabled && !busy}
        style={{ color: colors.label, fontSize: 17, minHeight: 44, padding: 0 }}
      />
      {names.map((name) => (
        <Pressable
          key={name}
          accessibilityRole="checkbox"
          accessibilityLabel={name}
          accessibilityState={{ checked: value.includes(name), disabled: disabled || busy }}
          disabled={disabled || busy}
          onPress={() =>
            onChange(
              value.includes(name) ? value.filter((entry) => entry !== name) : [...value, name],
            )
          }
          style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 12 }}
        >
          <Text style={{ color: colors.label, flex: 1, fontSize: 17 }}>{name}</Text>
          {value.includes(name) && (
            <SymbolView name="checkmark" tintColor={colors.accent} size={18} accessible={false} />
          )}
        </Pressable>
      ))}
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
    </View>
  );
}
