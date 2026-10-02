import { act, fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { BadgeLinkActions } from "@/components/badge-link-actions";
import { ScannerCodeEntry } from "@/components/scanner-code-entry";

let mockMenuProps: {
  actions: { id: string }[];
  onPressAction: (event: { nativeEvent: { event: string } }) => void;
};
jest.mock("@expo/ui/community/menu", () => ({
  MenuView: (props: typeof mockMenuProps & { children: unknown }) => {
    mockMenuProps = props;
    return props.children;
  },
}));
const mockTranslate = (key: string) => key;
jest.mock("expo-router", () => ({ useIsFocused: () => true }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: mockTranslate }) }));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarBottomInset: () => 0 }));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
}));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/theme/colors", () => ({
  colors: { label: "black", accent: "blue", primaryAction: "blue", primaryActionText: "white" },
}));

it("opens NFC directly and keeps code methods in the options menu", async () => {
  const onNfc = jest.fn();
  const onAlternative = jest.fn();
  const view = await render(
    <BadgeLinkActions onNfc={onNfc} onAlternative={onAlternative} disabled={false} />,
  );
  expect(
    StyleSheet.flatten(view.getByRole("button", { name: "personLinkBadgeNfc" }).props.style)
      .borderRadius,
  ).toBe(25);
  await fireEvent.press(view.getByRole("button", { name: "personLinkBadgeNfc" }));
  expect(onNfc).toHaveBeenCalledTimes(1);
  expect(onAlternative).not.toHaveBeenCalled();
  expect(view.queryByRole("button", { name: "personEnterBadgeCode" })).toBeNull();
  expect(view.getByRole("button", { name: "personBadgeOptions" })).toBeTruthy();
  expect(mockMenuProps.actions.map((action) => action.id)).toEqual(["qr", "manual"]);
  await act(() => mockMenuProps.onPressAction({ nativeEvent: { event: "manual" } }));
  expect(onAlternative).toHaveBeenCalledWith("manual");
});

it("disables both linking methods while an input is already open", async () => {
  const onNfc = jest.fn();
  const onAlternative = jest.fn();
  const view = await render(
    <BadgeLinkActions onNfc={onNfc} onAlternative={onAlternative} disabled />,
  );
  await fireEvent.press(view.getByRole("button", { name: "personLinkBadgeNfc" }));
  await act(() => mockMenuProps.onPressAction({ nativeEvent: { event: "qr" } }));
  expect(onNfc).not.toHaveBeenCalled();
  expect(onAlternative).not.toHaveBeenCalled();
  expect(view.getByRole("button", { name: "personBadgeOptions" })).toBeDisabled();
});

it("rejects empty entry and trims a badge code, submitting only once", async () => {
  const onValue = jest.fn();
  const onClose = jest.fn();
  const view = await render(
    <ScannerCodeEntry visible onValue={onValue} onClose={onClose} submitLabel="Link badge" />,
  );
  const input = view.getByLabelText("scannerManualEntryTitle");
  expect(view.getByRole("button", { name: "Link badge" })).toBeDisabled();
  await fireEvent(input, "submitEditing");
  expect(onValue).not.toHaveBeenCalled();
  await fireEvent.changeText(input, "  BADGE-50  ");
  await fireEvent(input, "submitEditing");
  await fireEvent.press(view.getByRole("button", { name: "Link badge" }));
  expect(onValue).toHaveBeenCalledTimes(1);
  expect(onValue).toHaveBeenCalledWith("BADGE-50");
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("clears a canceled code before the next entry", async () => {
  const onValue = jest.fn();
  const onClose = jest.fn();
  const view = await render(<ScannerCodeEntry visible onValue={onValue} onClose={onClose} />);
  await fireEvent.changeText(view.getByLabelText("scannerManualEntryTitle"), "OLD-CODE");
  await fireEvent.press(view.getByRole("button", { name: "cancel" }));
  expect(onValue).not.toHaveBeenCalled();
  await view.rerender(<ScannerCodeEntry visible={false} onValue={onValue} onClose={onClose} />);
  await view.rerender(<ScannerCodeEntry visible onValue={onValue} onClose={onClose} />);
  expect(view.getByLabelText("scannerManualEntryTitle").props.value).toBe("");
});
