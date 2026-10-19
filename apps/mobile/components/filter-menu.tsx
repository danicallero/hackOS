import Stack from "expo-router/stack";
import { View } from "react-native";
import { GlassView, type GlassViewProps } from "@/components/glass-view";
import { AndroidFilterMenu } from "@/components/native-ui";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { useFilterAsToolbarMenu } from "@/components/toolbar-filter-slot";
import { colors } from "@/theme/colors";

export interface FilterMenuProps {
  items: Array<{
    id: string;
    label: string;
    icon?: SymbolViewProps["name"];
    selected: boolean;
    section?: string;
  }>;
  colorScheme?: GlassViewProps["colorScheme"];
  /** Use the surrounding native toolbar background instead of adding another surface. */
  embedded?: boolean;
  accessibilityLabel: string;
  active: boolean;
  onSelect: (id: string) => void;
}

export function FilterMenu({
  items,
  accessibilityLabel,
  active,
  onSelect,
  colorScheme = "auto",
  embedded = false,
}: FilterMenuProps) {
  const asToolbarMenu = useFilterAsToolbarMenu();
  if (asToolbarMenu) {
    return (
      <Stack.Toolbar.Menu
        icon="line.3.horizontal.decrease"
        accessibilityLabel={accessibilityLabel}
        tintColor={active ? colors.accent : undefined}
      >
        {items.map((item) => (
          <Stack.Toolbar.MenuAction
            key={item.id}
            isOn={item.selected}
            unstable_keepPresented
            onPress={() => onSelect(item.id)}
          >
            {item.label}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
    );
  }
  const content = (
    <View style={{ width: 48, height: 48 }}>
      <AndroidFilterMenu
        accessibilityLabel={accessibilityLabel}
        items={items}
        onSelect={onSelect}
        closeOnSelect={false}
      >
        <SymbolView
          accessible={false}
          name="line.3.horizontal.decrease"
          size={19}
          tintColor={active ? colors.accent : colorScheme === "dark" ? "white" : colors.label}
        />
      </AndroidFilterMenu>
    </View>
  );
  return embedded ? (
    content
  ) : (
    <GlassView
      colorScheme={colorScheme}
      glassEffectStyle="regular"
      isInteractive
      style={{ width: 48, height: 48, borderRadius: 24 }}
    >
      {content}
    </GlassView>
  );
}
