import { useColorScheme, View } from "react-native";

import { OpaqueRouterTabs } from "@/components/opaque-router-tabs";
import { useMeContext } from "@/lib/me-context";

/**
 * H55: one custom router tab bar on every iOS and Android surface. Five
 * destinations fit directly; `Others` is a separate native menu circle only
 * when the capability-driven navigation set is larger than that budget.
 *
 * The overflow entries are pseudo-tabs, not ordinary stack links. Their
 * replace/no-op contract lives in `OpaqueRouterTabs` and
 * `lib/operations-navigation.ts`, so selecting a different overflow section
 * never accumulates duplicate screens.
 */
export default function TabLayout() {
  useColorScheme();
  const { me, loading: meLoading } = useMeContext();
  const capabilities = me?.capabilities ?? [];

  // Keep the initial loading guard: mounting the router before the profile is
  // known would register a participant tab set and then change it underneath
  // the selected route when capabilities arrive.
  if (meLoading && !me) return null;
  if (!me?.hasEventAccess) return null;

  return (
    <View style={{ flex: 1 }}>
      <OpaqueRouterTabs
        capabilities={capabilities}
        hasQueueItems={me.hasQueueItems}
        account={{
          name: [me.name, me.surname].filter(Boolean).join(" ") || me.email,
          image: me.image,
        }}
      />
    </View>
  );
}
