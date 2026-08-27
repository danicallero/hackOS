import { fireEvent, render, userEvent } from "@testing-library/react-native";

jest.mock("@/components/native-ui", () => {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  return {
    ActionButton: ({
      busy,
      disabled,
      label,
      onPress,
    }: {
      busy?: boolean;
      disabled?: boolean;
      label: string;
      onPress: () => void;
    }) =>
      ReactLib.createElement(
        Native.Pressable,
        {
          accessibilityLabel: label,
          accessibilityRole: "button",
          accessibilityState: { busy, disabled },
          disabled: busy || disabled,
          onPress,
        },
        ReactLib.createElement(Native.Text, null, label),
      ),
  };
});
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string) =>
      ({
        accountAnonymizeAction: "Anonymize my data and close account",
        accountRemovalPinDescription: "We sent a security PIN to your verified email.",
        accountRemovalPinLabel: "Security PIN",
        accountDeleteAction: "Delete my account",
        cancel: "Cancel",
      })[key] ?? key,
  }),
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    destructive: "#d70015",
    elevatedSurface: "#ffffff",
    label: "#171717",
    secondaryLabel: "#5f6368",
    separator: "#d1d1d6",
    tertiaryLabel: "#7c7c80",
  },
}));

import { AccountRemovalPinModal } from "@/components/account-removal-pin-modal";

describe("account removal PIN modal", () => {
  it("accepts only six digits and submits the PIN", async () => {
    const onConfirm = jest.fn();

    const view = await render(
      <AccountRemovalPinModal action="delete" onCancel={jest.fn()} onConfirm={onConfirm} visible />,
    );

    const user = userEvent.setup();
    const input = view.getByLabelText("Security PIN");
    await user.type(input, "12a34567");
    expect(view.getByLabelText("Security PIN")).toHaveProp("value", "123456");
    expect(view.getByRole("button", { name: "Delete my account" })).toBeEnabled();

    fireEvent.press(view.getByRole("button", { name: "Delete my account" }));

    expect(onConfirm).toHaveBeenCalledWith("123456");
  });

  it("announces an API error without closing the modal", async () => {
    const view = await render(
      <AccountRemovalPinModal
        action="anonymize"
        error="The security PIN is incorrect."
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
        visible
      />,
    );

    expect(view.getByRole("alert")).toHaveTextContent("The security PIN is incorrect.");
    expect(view.getByLabelText("Security PIN")).toBeTruthy();
  });
});
