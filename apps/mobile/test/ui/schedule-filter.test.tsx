import { fireEvent, screen } from "@testing-library/react-native";
import { ScheduleFilterButton } from "@/components/schedule-filter-button";
import { renderMobile } from "./render";

jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));

jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
jest.mock("@/components/filter-menu", () => ({
  FilterMenu: ({
    items,
    onSelect,
  }: {
    items: { id: string; label: string; selected: boolean }[];
    onSelect: (id: string) => void;
  }) => {
    const { Pressable, Text, View } = jest.requireActual("react-native");
    return (
      <View>
        {items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityLabel={item.id}
            accessibilityState={{ selected: item.selected }}
            onPress={() => onSelect(item.id)}
          >
            <Text>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    );
  },
}));

const onToggleKind = jest.fn();
const onToggleAudience = jest.fn();
const onClear = jest.fn();
const props = {
  kinds: ["meal", "other"],
  selectedKinds: ["meal"],
  selectedAudiences: ["staff" as const],
  onToggleKind,
  onToggleAudience,
  onClear,
  showAudience: true,
};
beforeEach(() => jest.clearAllMocks());

it("preserves each kind and audience selection and clears both dimensions", async () => {
  await renderMobile(<ScheduleFilterButton {...props} />);
  expect(screen.getByLabelText("kind:meal").props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText("kind:other").props.accessibilityState.selected).toBe(false);
  expect(screen.getByLabelText("audience:staff").props.accessibilityState.selected).toBe(true);
  for (const audience of ["participant", "sponsor", "mentor", "staff"]) {
    await fireEvent.press(screen.getByLabelText(`audience:${audience}`));
    expect(onToggleAudience).toHaveBeenLastCalledWith(audience);
  }
  await fireEvent.press(screen.getByLabelText("kind:other"));
  expect(onToggleKind).toHaveBeenCalledWith("other");
  await fireEvent.press(screen.getByLabelText("clear"));
  expect(onClear).toHaveBeenCalledTimes(1);
});

it("withholds audience choices without the schedule capability", async () => {
  await renderMobile(<ScheduleFilterButton {...props} showAudience={false} />);
  expect(screen.queryByLabelText("audience:staff")).toBeNull();
  expect(screen.queryByLabelText("audience:participant")).toBeNull();
  expect(screen.getByLabelText("kind:meal")).toBeTruthy();
});

it("omits reset when no filters are selected", async () => {
  await renderMobile(<ScheduleFilterButton {...props} selectedKinds={[]} selectedAudiences={[]} />);
  expect(screen.queryByLabelText("clear")).toBeNull();
});
