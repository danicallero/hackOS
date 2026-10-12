import { fireEvent, screen, waitFor } from "@testing-library/react-native";

const mockApiFetch = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }));
jest.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ language: "en", t: (key: string) => key }) }));
jest.mock("@/theme/colors", () => ({ colors: new Proxy({}, { get: () => "#000000" }) }));
jest.mock("@/components/native-ui", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  const box = ({ children }: { children?: unknown }) =>
    ReactLib.createElement(Native.View, null, children);
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
          disabled: busy || disabled,
          onPress,
        },
        ReactLib.createElement(Native.Text, null, label),
      ),
    Section: box,
    Separator: () => null,
    ToggleRow: ({
      label,
      value,
      onChange,
    }: {
      label: string;
      value: boolean;
      onChange: (value: boolean) => void;
    }) =>
      ReactLib.createElement(Native.Switch, {
        accessibilityLabel: label,
        onValueChange: onChange,
        value,
      }),
  };
});
jest.mock("@/components/RequestFeedback", () => ({ RequestFeedback: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));

import { NetworkingInvite } from "@/components/networking-invite";
import NetworkingProfileScreen from "@/components/networking-profile-screen";
import { renderMobile } from "./render";

const profile = {
  directoryVisible: false,
  showSurname: false,
  showPhoto: false,
  showProject: true,
  headline: null,
  locationNote: null,
  bio: null,
  consentedAt: null,
};

beforeEach(() => {
  mockApiFetch.mockReset();
  mockPush.mockReset();
  mockBack.mockReset();
});

describe("NetworkingInvite after confirming a spot (H15)", () => {
  it("explains the profile and opens the editor when it was never created", async () => {
    mockApiFetch.mockResolvedValue(profile);
    await renderMobile(<NetworkingInvite />);
    expect(await screen.findByText("networkingInvite")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "networkingInviteAction" }));
    expect(mockPush).toHaveBeenCalledWith("/networking-profile");
  });

  it("stays out of the way once the profile has been created", async () => {
    mockApiFetch.mockResolvedValue({ ...profile, consentedAt: "2026-10-10T10:00:00.000Z" });
    await renderMobile(<NetworkingInvite />);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(screen.queryByText("networkingInvite")).toBeNull();
  });

  it("hides when the profile cannot be read", async () => {
    mockApiFetch.mockRejectedValue(new Error("403"));
    await renderMobile(<NetworkingInvite />);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(screen.queryByText("networkingInvite")).toBeNull();
  });
});

describe("NetworkingProfileScreen", () => {
  it("saves the shared profile and leaves links and CV to the API's stored values", async () => {
    mockApiFetch.mockResolvedValueOnce(profile).mockResolvedValueOnce({ ...profile });
    await renderMobile(<NetworkingProfileScreen />);
    const share = await screen.findByLabelText("networkingShare");
    expect(screen.queryByLabelText("networkingHeadline")).toBeNull();
    await fireEvent(share, "valueChange", true);
    await fireEvent.changeText(await screen.findByLabelText("networkingHeadline"), " Robots ");
    await fireEvent.press(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const [path, init] = mockApiFetch.mock.calls[1];
    expect(path).toBe("/api/me/public-profile");
    expect(init.method).toBe("PUT");
    expect(init.headers["Idempotency-Key"]).toBeTruthy();
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ directoryVisible: true, headline: "Robots", bio: null });
    expect(body).not.toHaveProperty("socials");
    expect(body).not.toHaveProperty("shareCv");
  });
});
