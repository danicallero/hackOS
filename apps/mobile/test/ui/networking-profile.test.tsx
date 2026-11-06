import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, Platform, StyleSheet } from "react-native";

const mockApiFetch = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockPickDocument = jest.fn();
const mockHeaderOptions = jest.fn();
jest.mock("@/components/adaptive-frame", () => ({
  withSheetFrame: (Screen: unknown) => (props: object) => {
    const ReactLib = require("react");
    const { View } = require("react-native");
    return ReactLib.createElement(
      View,
      { testID: "networking-sheet-frame" },
      ReactLib.createElement(Screen, props),
    );
  },
}));
let mockNativeHeader = false;
jest.mock("@/components/glass-view", () => ({
  isRealLiquidGlassAvailable: () => mockNativeHeader,
}));
jest.mock("expo-router/stack", () => {
  const ReactLib = require("react");
  const { View, Pressable } = require("react-native");
  const Toolbar = ({ children, placement }: { children: unknown; placement: string }) =>
    ReactLib.createElement(View, { testID: `native-toolbar-${placement}` }, children);
  Toolbar.Button = (props: object) =>
    ReactLib.createElement(Pressable, { ...props, accessibilityRole: "button" });
  return {
    __esModule: true,
    default: {
      Screen: ({ options }: { options: object }) => {
        mockHeaderOptions(options);
        return null;
      },
      Toolbar,
    },
  };
});

jest.mock("expo-file-system", () => ({
  File: class extends Blob {
    constructor() {
      super(["x"]);
    }
  },
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }));
jest.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  getCurrentSessionCookie: () => "",
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
jest.mock("@/lib/env", () => ({ API_URL: "https://api.test" }));
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: (...args: unknown[]) => mockPickDocument(...args),
}));
jest.mock("@/components/cv-viewer", () => ({ CvViewer: () => null }));
jest.mock("@/components/person-avatar", () => ({ PersonAvatar: () => null }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ language: "en", t: (key: string) => key }) }));
jest.mock("@/theme/colors", () => ({ colors: new Proxy({}, { get: () => "#000000" }) }));
jest.mock("@/components/native-ui", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  const box = ({ children }: { children?: unknown }) =>
    ReactLib.createElement(Native.View, null, children);
  return {
    ActionButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      ReactLib.createElement(
        Native.Pressable,
        { accessibilityLabel: label, accessibilityRole: "button", onPress },
        ReactLib.createElement(Native.Text, null, label),
      ),
    FloatingGlassButton: ({
      accessibilityLabel,
      disabled,
      onPress,
      top,
    }: {
      top: number;
      accessibilityLabel: string;
      disabled?: boolean;
      onPress: () => void;
    }) =>
      ReactLib.createElement(Native.Pressable, {
        accessibilityLabel,
        accessibilityRole: "button",
        disabled,
        onPress,
        style: { top },
      }),
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
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({
    me: { name: "Ada", surname: "Lovelace", email: "ada@example.com", image: null },
  }),
}));
// The photo control has its own tests (profile-photo-menu.test.tsx).
jest.mock("@/components/profile-photo-menu", () => {
  const Native = require("react-native");
  const ReactLib = require("react");
  return {
    ProfilePhotoMenu: ({ name }: { name: string }) =>
      ReactLib.createElement(Native.View, { accessibilityLabel: `photo-menu:${name}` }),
  };
});
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));

import { NetworkingInvite } from "@/components/networking-invite";
import NetworkingProfileScreen from "@/components/networking-profile-screen";
import NetworkingProfileRoute from "../../app/networking-profile";
import { renderMobile } from "./render";

const profile = {
  directoryVisible: false,
  showSurname: false,
  showPhoto: false,
  showProject: true,
  headline: null,
  locationNote: null,
  bio: null,
  shareCv: false,
  cv: null,
  consentedAt: null,
  preview: {
    userId: 1,
    displayName: "Ada L.",
    photoUrl: null,
    headline: null,
    bio: null,
    locationNote: null,
    socials: [],
    cvUrl: null,
    projects: [],
    challenges: [],
  },
};
const shared = {
  ...profile,
  directoryVisible: true,
  headline: "Robots",
  consentedAt: "2026-10-10T10:00:00.000Z",
  preview: { ...profile.preview, headline: "Robots" },
};
const withUploadedCv = {
  ...shared,
  shareCv: true,
  cv: { filename: "ada.pdf", source: "upload" as const },
  preview: { ...shared.preview, cvUrl: "/api/me/public-profile/cv" },
};
const withApplicationCv = {
  ...withUploadedCv,
  cv: { filename: "app.pdf", source: "application" as const },
};

function opacityOf(element: { props: { style?: unknown } }): number | undefined {
  return (StyleSheet.flatten(element.props.style as object) as { opacity?: number })?.opacity;
}

beforeEach(() => {
  mockNativeHeader = false;
  mockHeaderOptions.mockReset();
  mockApiFetch.mockReset();
  mockPush.mockReset();
  mockBack.mockReset();
  mockPickDocument.mockReset();
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
  it("opens on the card scanners see, with the share switch and a pencil (#934)", async () => {
    mockApiFetch.mockResolvedValueOnce(withUploadedCv);
    await renderMobile(<NetworkingProfileScreen />);
    expect(await screen.findByText("Ada L.")).toBeTruthy();
    expect(screen.getByText("Robots")).toBeTruthy();
    expect(screen.getByLabelText("networkingShare")).toBeTruthy();
    expect(screen.getByRole("button", { name: "directoryCv" })).toBeTruthy();
    expect(screen.queryByLabelText("networkingHeadline")).toBeNull();
    expect(screen.queryByRole("switch", { name: "directoryCv" })).toBeNull();
  });

  it("starts in edit mode while nothing is shared, with the photo control", async () => {
    mockApiFetch.mockResolvedValueOnce(profile);
    await renderMobile(<NetworkingProfileScreen />);
    expect(await screen.findByLabelText("photo-menu:Ada Lovelace")).toBeTruthy();
    expect(screen.getByLabelText("networkingHeadline")).toBeTruthy();
  });

  it("saves the share switch at once from the preview and rolls back on failure", async () => {
    mockApiFetch
      .mockResolvedValueOnce(shared)
      .mockResolvedValueOnce({ ...shared, directoryVisible: false })
      .mockRejectedValueOnce(new Error("offline"));
    await renderMobile(<NetworkingProfileScreen />);
    const share = await screen.findByLabelText("networkingShare");
    await fireEvent(share, "valueChange", false);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
    const [path, init] = mockApiFetch.mock.calls[1];
    expect(path).toBe("/api/me/public-profile");
    expect(init.method).toBe("PUT");
    expect(init.headers["Idempotency-Key"]).toBeTruthy();
    expect(JSON.parse(init.body)).toMatchObject({ directoryVisible: false, headline: "Robots" });
    await waitFor(() => expect(screen.getByLabelText("networkingShare").props.value).toBe(false));

    await fireEvent(screen.getByLabelText("networkingShare"), "valueChange", true);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByLabelText("networkingShare").props.value).toBe(false));
  });

  it("edits in place, greys the CV when its eye is closed and saves shareCv false", async () => {
    mockApiFetch.mockResolvedValueOnce(withUploadedCv).mockResolvedValueOnce({
      ...withUploadedCv,
      shareCv: false,
      preview: { ...withUploadedCv.preview, cvUrl: null },
    });
    await renderMobile(<NetworkingProfileScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "networkingEdit" }));
    const eye = screen.getByRole("switch", { name: "directoryCv" });
    expect(eye.props.accessibilityState.checked).toBe(true);
    expect(opacityOf(screen.getByRole("button", { name: "directoryCv" }))).toBe(1);

    await fireEvent.press(eye);
    expect(
      screen.getByRole("switch", { name: "directoryCv" }).props.accessibilityState.checked,
    ).toBe(false);
    expect(opacityOf(screen.getByRole("button", { name: "directoryCv" }))).toBe(0.4);

    await fireEvent.changeText(screen.getByLabelText("networkingHeadline"), " Rovers ");
    await fireEvent.press(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
    const [path, init] = mockApiFetch.mock.calls[1];
    expect(path).toBe("/api/me/public-profile");
    expect(init.method).toBe("PUT");
    expect(init.headers["Idempotency-Key"]).toBeTruthy();
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ shareCv: false, headline: "Rovers", directoryVisible: true });
    expect(body).not.toHaveProperty("socials");
    // Back to the preview, which no longer carries the CV.
    await waitFor(() => expect(screen.queryByRole("button", { name: "save" })).toBeNull());
    expect(screen.queryByRole("button", { name: "directoryCv" })).toBeNull();
  });

  it("keeps hidden photo and surname on screen while editing", async () => {
    mockApiFetch.mockResolvedValueOnce(shared);
    await renderMobile(<NetworkingProfileScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "networkingEdit" }));
    const photoEye = screen.getByRole("switch", { name: "networkingShowPhoto" });
    expect(photoEye.props.accessibilityState.checked).toBe(false);
    expect(screen.getByLabelText("photo-menu:Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Ada L.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("switch", { name: "networkingShowSurname" }));
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  });

  it("discards edits with the close button", async () => {
    mockApiFetch.mockResolvedValueOnce(shared);
    await renderMobile(<NetworkingProfileScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "networkingEdit" }));
    await fireEvent.changeText(screen.getByLabelText("networkingHeadline"), "Other");
    await fireEvent.press(screen.getByRole("button", { name: "cancel" }));
    expect(screen.getByText("Robots")).toBeTruthy();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it("offers no upload or removal for a CV from the application", async () => {
    mockApiFetch.mockResolvedValueOnce(withApplicationCv);
    await renderMobile(<NetworkingProfileScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "networkingEdit" }));
    expect(screen.getByRole("switch", { name: "directoryCv" })).toBeTruthy();
    expect(screen.queryByText("networkingCvUpload")).toBeNull();
    expect(screen.queryByText("networkingCvReplace")).toBeNull();
    expect(screen.queryByText("networkingCvRemove")).toBeNull();
  });

  it("uploads a CV when there is none, then lets it be shared", async () => {
    const uploaded = { ...shared, cv: { filename: "ada.pdf", source: "upload" as const } };
    mockApiFetch
      .mockResolvedValueOnce(shared)
      .mockResolvedValueOnce(uploaded)
      .mockResolvedValueOnce({ ...uploaded, shareCv: true, preview: withUploadedCv.preview });
    mockPickDocument.mockResolvedValueOnce({
      canceled: false,
      assets: [
        { uri: "file:///ada.pdf", name: "ada.pdf", mimeType: "application/pdf", size: 1000 },
      ],
    });
    await renderMobile(<NetworkingProfileScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "networkingEdit" }));
    expect(screen.queryByRole("switch", { name: "directoryCv" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "networkingCvUpload" }));

    const eye = await screen.findByRole("switch", { name: "directoryCv" });
    const [path, init] = mockApiFetch.mock.calls[1];
    expect(path).toBe("/api/me/public-profile/cv");
    expect(init.method).toBe("POST");
    expect(init.headers["Idempotency-Key"]).toBeTruthy();
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get("file")).toBeInstanceOf(Blob);
    expect(eye.props.accessibilityState.checked).toBe(false);

    await fireEvent.press(eye);
    await fireEvent.press(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(mockApiFetch.mock.calls[2][1].body)).toMatchObject({ shareCv: true });
    expect(await screen.findByRole("button", { name: "directoryCv" })).toBeTruthy();
  });

  it("rejects a file that is not a PDF before uploading", async () => {
    mockApiFetch.mockResolvedValueOnce(shared);
    mockPickDocument.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///a.png", name: "a.png", mimeType: "image/png", size: 10 }],
    });
    await renderMobile(<NetworkingProfileScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "networkingEdit" }));
    await fireEvent.press(screen.getByRole("button", { name: "networkingCvUpload" }));
    await waitFor(() => expect(mockPickDocument).toHaveBeenCalled());
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it("replaces and removes an uploaded CV", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockApiFetch
      .mockResolvedValueOnce(withUploadedCv)
      .mockResolvedValueOnce(withUploadedCv)
      .mockResolvedValueOnce({ ...shared, cv: null, shareCv: false });
    mockPickDocument.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///new.pdf", name: "new.pdf", mimeType: "application/pdf", size: 5 }],
    });
    await renderMobile(<NetworkingProfileScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "networkingEdit" }));
    await fireEvent.press(screen.getByRole("button", { name: "networkingCvReplace" }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
    expect(mockApiFetch.mock.calls[1][1].method).toBe("POST");

    await fireEvent.press(screen.getByRole("button", { name: "networkingCvRemove" }));
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((button) => button.text === "remove")?.onPress?.();
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(3));
    expect(mockApiFetch.mock.calls[2][1].method).toBe("DELETE");
    await waitFor(() => expect(screen.queryByRole("switch", { name: "directoryCv" })).toBeNull());
    expect(screen.getByRole("button", { name: "networkingCvUpload" })).toBeTruthy();
    alert.mockRestore();
  });
});

describe("Networking profile safe areas and native controls (H55, #935)", () => {
  test("fallback chrome clears a nonzero sheet top safe area", async () => {
    mockApiFetch.mockResolvedValue(shared);
    await renderMobile(<NetworkingProfileRoute />, { insets: { top: 47 } });
    expect(screen.getByTestId("networking-sheet-frame")).toBeTruthy();
    const edit = await screen.findByRole("button", { name: "networkingEdit" });
    expect(StyleSheet.flatten(edit.props.style).top).toBe(63);
    expect(
      StyleSheet.flatten(
        screen.getByTestId("networking-profile-scroll").props.contentContainerStyle,
      ).paddingTop,
    ).toBe(63);
  });

  test("Liquid Glass uses native toolbar actions instead of floating sheet controls", async () => {
    const previousOs = process.env.EXPO_OS;
    process.env.EXPO_OS = "ios";
    mockNativeHeader = true;
    try {
      mockApiFetch.mockResolvedValue(shared);
      await renderMobile(<NetworkingProfileRoute />);
      await screen.findByRole("button", { name: "networkingEdit" });
      expect(screen.queryByTestId("networking-sheet-frame")).toBeNull();
      expect(screen.getByTestId("native-toolbar-left")).toBeTruthy();
      expect(screen.getByTestId("native-toolbar-right")).toBeTruthy();
      expect(screen.getByRole("button", { name: "networkingEdit" }).props.style).toBeUndefined();
      expect(screen.queryByText("networkingTitle")).toBeNull();
      expect(
        screen.getByTestId("networking-profile-scroll").props.contentInsetAdjustmentBehavior,
      ).toBe("automatic");
      await fireEvent.press(screen.getByRole("button", { name: "networkingEdit" }));
      expect(screen.getByRole("button", { name: "save" })).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "cancel" }));
      expect(screen.getByRole("button", { name: "networkingEdit" })).toBeTruthy();
    } finally {
      if (previousOs === undefined) delete process.env.EXPO_OS;
      else process.env.EXPO_OS = previousOs;
      mockNativeHeader = false;
    }
  });
  test("iPad sheet keeps a compact title and does not inherit the window side column", async () => {
    const previousOs = process.env.EXPO_OS;
    const padDescriptor = Object.getOwnPropertyDescriptor(Platform, "isPad");
    process.env.EXPO_OS = "ios";
    Object.defineProperty(Platform, "isPad", { configurable: true, value: true });
    mockNativeHeader = true;
    try {
      mockApiFetch.mockResolvedValue(shared);
      await renderMobile(<NetworkingProfileRoute />, { insets: { left: 200 } });
      await screen.findByRole("button", { name: "networkingEdit" });
      expect(mockHeaderOptions).toHaveBeenLastCalledWith(
        expect.objectContaining({ headerLargeTitle: false }),
      );
      expect(
        StyleSheet.flatten(screen.getByTestId("networking-profile-scroll").props.style).paddingLeft,
      ).toBeUndefined();
    } finally {
      if (previousOs === undefined) delete process.env.EXPO_OS;
      else process.env.EXPO_OS = previousOs;
      if (padDescriptor) Object.defineProperty(Platform, "isPad", padDescriptor);
      else Reflect.deleteProperty(Platform, "isPad");
      mockNativeHeader = false;
    }
  });
});
