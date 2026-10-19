import { Host, Menu, RNHostView, Section, Toggle } from "@expo/ui/swift-ui";
import { menuActionDismissBehavior } from "@expo/ui/swift-ui/modifiers";
import Stack from "expo-router/stack";
import { View } from "react-native";
import type { FilterMenuProps } from "@/components/filter-menu";
import { GlassView } from "@/components/glass-view";
import { SymbolView } from "@/components/symbol";
import { useFilterAsToolbarMenu } from "@/components/toolbar-filter-slot";
import { colors } from "@/theme/colors";

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
  const sections = items.reduce<
    Array<{ title: string | undefined; items: FilterMenuProps["items"] }>
  >((groups, item) => {
    const group = groups.find((section) => section.title === item.section);
    if (group) group.items.push(item);
    else groups.push({ title: item.section, items: [item] });
    return groups;
  }, []);
  const renderItems = (rows: FilterMenuProps["items"]) =>
    rows.map((item) => (
      <Toggle
        key={item.id}
        label={item.label}
        systemImage={typeof item.icon === "string" ? item.icon : undefined}
        isOn={item.selected}
        onIsOnChange={() => onSelect(item.id)}
        modifiers={[menuActionDismissBehavior("disabled")]}
      />
    ));
  const content = (
    <View style={{ width: 48, height: 48 }}>
      <Host
        colorScheme={colorScheme === "auto" ? undefined : colorScheme}
        matchContents
        style={{ width: 48, height: 48 }}
        ignoreSafeArea="all"
      >
        <Menu
          modifiers={[menuActionDismissBehavior("disabled")]}
          label={
            <RNHostView matchContents>
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityState={{ selected: active }}
                style={{ width: 48, height: 48, justifyContent: "center", alignItems: "center" }}
              >
                <SymbolView
                  accessible={false}
                  name="line.3.horizontal.decrease"
                  size={19}
                  tintColor={
                    active ? colors.accent : colorScheme === "dark" ? "white" : colors.label
                  }
                />
              </View>
            </RNHostView>
          }
        >
          {sections.map((section) =>
            section.title ? (
              <Section key={section.title} title={section.title}>
                {renderItems(section.items)}
              </Section>
            ) : (
              <Section key="ungrouped">{renderItems(section.items)}</Section>
            ),
          )}
        </Menu>
      </Host>
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
