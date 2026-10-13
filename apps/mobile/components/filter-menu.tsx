import { GlassView, type GlassViewProps } from "@/components/glass-view";
import { AndroidFilterMenu } from "@/components/native-ui";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
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
}: FilterMenuProps) {
  return (
    <GlassView
      colorScheme={colorScheme}
      glassEffectStyle="regular"
      isInteractive
      style={{ width: 48, height: 48, borderRadius: 24 }}
    >
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
    </GlassView>
  );
}
