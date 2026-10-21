import { useNavigation } from "expo-router";
import { useLayoutEffect, useState } from "react";

/**
 * Native integrated search in the navigation header, configured exactly like
 * Schedule's so the control owns its expansion and focus lifecycle (R025).
 * Returns the current query; a null placeholder leaves the header untouched.
 */
export function useHeaderSearch(placeholder: string | null): string {
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  useLayoutEffect(() => {
    if (placeholder === null) return;
    navigation.setOptions({
      headerSearchBarOptions: {
        placeholder,
        autoCapitalize: "none",
        hideWhenScrolling: false,
        allowToolbarIntegration: false,
        placement: "integratedButton",
        onChangeText: (event: { nativeEvent: { text: string } }) =>
          setQuery(event.nativeEvent.text),
      },
    });
  }, [navigation, placeholder]);
  return query;
}

/** Case-insensitive substring match over the given fields. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field?.toLowerCase().includes(needle));
}
