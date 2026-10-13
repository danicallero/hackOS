jest.mock("@/components/filter-menu", () => jest.requireActual("@/components/filter-menu.tsx"));

import { fireEvent, render } from "@testing-library/react-native";
import { useState } from "react";
import { FilterMenu } from "@/components/filter-menu";

jest.mock("@/components/glass-view", () => ({
  GlassView: require("react-native").View,
  isRealLiquidGlassAvailable: () => false,
}));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/lib/use-android-top-inset", () => ({ useAndroidTopInset: () => 0 }));
jest.mock("@/theme/colors", () => ({ colors: {} }));

it("keeps multiple choices selected in the same open menu until dismissed", async () => {
  function Example() {
    const [selected, setSelected] = useState<string[]>([]);
    return (
      <FilterMenu
        accessibilityLabel="Filter"
        active={selected.length > 0}
        items={[
          { id: "all", label: "All", selected: selected.length === 0 },
          ...["Meals", "Talks"].map((id) => ({
            id,
            label: id,
            section: "Kind",
            selected: selected.includes(id),
          })),
        ]}
        onSelect={(id) =>
          setSelected((current) =>
            id === "all"
              ? []
              : current.includes(id)
                ? current.filter((value) => value !== id)
                : [...current, id],
          )
        }
      />
    );
  }
  const view = await render(<Example />);
  await fireEvent.press(view.getByRole("button", { name: "Filter" }));
  expect(view.getByRole("header", { name: "Kind" })).toBeTruthy();
  await fireEvent.press(view.getByRole("menuitem", { name: "Meals" }));
  await fireEvent.press(view.getByRole("menuitem", { name: "Talks" }));
  expect(view.getByRole("menuitem", { name: "Meals" }).props.accessibilityState.selected).toBe(
    true,
  );
  expect(view.getByRole("menuitem", { name: "Talks" }).props.accessibilityState.selected).toBe(
    true,
  );
  await fireEvent.press(view.getByRole("menuitem", { name: "All" }));
  expect(view.getByRole("menuitem", { name: "Meals" }).props.accessibilityState.selected).toBe(
    false,
  );
  expect(view.getByRole("menuitem", { name: "Talks" }).props.accessibilityState.selected).toBe(
    false,
  );
  await fireEvent.press(view.getByRole("button", { name: "close" }));
  expect(view.queryByRole("menuitem", { name: "Meals" })).toBeNull();
});
