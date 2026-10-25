import { act, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

const mockApiFetch = jest.fn();
const mockRefetch = jest.fn();
const mockCamera = jest.fn();
const mockCameraPermission = jest.fn();
const mockLibrary = jest.fn();
const mockManipulate = jest.fn();
let mockMenu: {
  actions: { id: string; title: string }[];
  onPressAction: (event: { nativeEvent: { event: string } }) => void;
} | null = null;

jest.mock("expo-file-system", () => ({
  File: class extends Blob {
    constructor() {
      super(["x"]);
    }
  },
}));
jest.mock("@expo/ui/community/menu", () => ({
  MenuView: (props: { children: unknown } & NonNullable<typeof mockMenu>) => {
    mockMenu = props;
    return props.children;
  },
}));
jest.mock("expo-image-picker", () => ({
  launchCameraAsync: (...args: unknown[]) => mockCamera(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLibrary(...args),
  requestCameraPermissionsAsync: () => mockCameraPermission(),
}));
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: { manipulate: (...args: unknown[]) => mockManipulate(...args) },
}));
jest.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError, apiFetch: (...args: unknown[]) => mockApiFetch(...args) };
});
jest.mock("@/lib/me-context", () => ({ useMeContext: () => ({ refetch: mockRefetch }) }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ language: "en", t: (key: string) => key }) }));
jest.mock("@/lib/directory", () => ({ apiImageSource: (uri: string) => ({ uri }) }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/theme/colors", () => ({ colors: new Proxy({}, { get: () => "#000000" }) }));

import { ProfilePhotoMenu } from "@/components/profile-photo-menu";
import { ApiError } from "@/lib/api";
import { renderMobile } from "./render";

function press(id: string) {
  return act(async () => {
    mockMenu?.onPressAction({ nativeEvent: { event: id } });
  });
}

const picked = {
  canceled: false,
  assets: [{ uri: "file:///raw.heic", width: 4000, height: 3000 }],
};
let crop: jest.Mock;
let resize: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockMenu = null;
  mockApiFetch.mockResolvedValue({ image: "/api/users/1/photo?v=2" });
  mockRefetch.mockResolvedValue(null);
  mockCameraPermission.mockResolvedValue({ granted: true });
  mockLibrary.mockResolvedValue(picked);
  mockCamera.mockResolvedValue(picked);
  const context: Record<string, jest.Mock> = {};
  crop = jest.fn(() => context);
  resize = jest.fn(() => context);
  context.crop = crop;
  context.resize = resize;
  context.renderAsync = jest.fn().mockResolvedValue({
    saveAsync: jest.fn().mockResolvedValue({ uri: "file:///square.jpg" }),
  });
  mockManipulate.mockReturnValue(context);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

describe("ProfilePhotoMenu (#934)", () => {
  it("offers only take and choose when there is no photo", async () => {
    await renderMobile(<ProfilePhotoMenu name="Ada Lovelace" image={null} size={96} />);
    expect(mockMenu?.actions.map((action) => action.id)).toEqual(["camera", "library"]);
    expect(screen.getByLabelText("profilePhotoAdd")).toBeTruthy();
  });

  it("adds remove once a photo exists", async () => {
    await renderMobile(
      <ProfilePhotoMenu name="Ada Lovelace" image="/api/users/1/photo?v=1" size={96} />,
    );
    expect(mockMenu?.actions.map((action) => action.id)).toEqual(["camera", "library", "remove"]);
    expect(screen.getByLabelText("profilePhotoChange")).toBeTruthy();
  });

  it("crops to a centred square, uploads a JPEG with an idempotency key and refreshes me", async () => {
    await renderMobile(<ProfilePhotoMenu name="Ada Lovelace" image={null} size={96} />);
    await press("library");

    expect(mockLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ allowsEditing: true, aspect: [1, 1] }),
    );
    expect(crop).toHaveBeenCalledWith({ originX: 500, originY: 0, width: 3000, height: 3000 });
    expect(resize).toHaveBeenCalledWith({ width: 1024 });
    const [path, init] = mockApiFetch.mock.calls[0];
    expect(path).toBe("/api/me/photo");
    expect(init.method).toBe("POST");
    expect(init.headers["Idempotency-Key"]).toBeTruthy();
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get("file")).toBeInstanceOf(Blob);
    await waitFor(() => expect(mockRefetch).toHaveBeenCalledTimes(1));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("does nothing when the picker is cancelled", async () => {
    mockLibrary.mockResolvedValue({ canceled: true, assets: null });
    await renderMobile(<ProfilePhotoMenu name="Ada Lovelace" image={null} size={96} />);
    await press("library");
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("explains a denied camera permission without opening the camera", async () => {
    mockCameraPermission.mockResolvedValue({ granted: false });
    await renderMobile(<ProfilePhotoMenu name="Ada Lovelace" image={null} size={96} />);
    await press("camera");
    expect(mockCamera).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith("profilePhotoTitle", "profilePhotoCameraDenied");
  });

  it("takes a photo with the camera", async () => {
    await renderMobile(<ProfilePhotoMenu name="Ada Lovelace" image={null} size={96} />);
    await press("camera");
    expect(mockCamera).toHaveBeenCalled();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it("removes the photo and refreshes me", async () => {
    await renderMobile(
      <ProfilePhotoMenu name="Ada Lovelace" image="/api/users/1/photo?v=1" size={96} />,
    );
    await press("remove");
    const [path, init] = mockApiFetch.mock.calls[0];
    expect(path).toBe("/api/me/photo");
    expect(init.method).toBe("DELETE");
    expect(init.headers["Idempotency-Key"]).toBeTruthy();
    await waitFor(() => expect(mockRefetch).toHaveBeenCalledTimes(1));
  });

  it("shows a spinner and blocks a second change while uploading", async () => {
    let finish: (value: unknown) => void = () => {};
    mockApiFetch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await renderMobile(<ProfilePhotoMenu name="Ada Lovelace" image={null} size={96} />);
    await press("library");
    await waitFor(() => expect(screen.getByTestId("profile-photo-pending")).toBeTruthy());
    expect(mockMenu?.actions.every((action) => "attributes" in action)).toBe(true);
    await press("library");
    expect(mockLibrary).toHaveBeenCalledTimes(1);
    await act(async () => finish({ image: null }));
    await waitFor(() => expect(screen.queryByTestId("profile-photo-pending")).toBeNull());
  });

  it("reports an upload failure and keeps the photo", async () => {
    mockApiFetch.mockRejectedValue(new Error("offline"));
    await renderMobile(<ProfilePhotoMenu name="Ada Lovelace" image={null} size={96} />);
    await press("library");
    expect(Alert.alert).toHaveBeenCalledWith("profilePhotoTitle", "profilePhotoUploadError");
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("says why an account being removed cannot change its photo", async () => {
    mockApiFetch.mockRejectedValue(new ApiError("This account is being removed", 409));
    await renderMobile(<ProfilePhotoMenu name="Ada Lovelace" image={null} size={96} />);
    await press("library");
    expect(Alert.alert).toHaveBeenCalledWith("profilePhotoTitle", "profilePhotoAccountRemoving");
  });

  it("reports a rejected image and a failed removal", async () => {
    mockApiFetch.mockRejectedValueOnce(new ApiError("The photo must be a PNG", 400));
    await renderMobile(
      <ProfilePhotoMenu name="Ada Lovelace" image="/api/users/1/photo?v=1" size={96} />,
    );
    await press("library");
    expect(Alert.alert).toHaveBeenLastCalledWith("profilePhotoTitle", "profilePhotoRejected");
    mockApiFetch.mockRejectedValueOnce(new Error("offline"));
    await press("remove");
    expect(Alert.alert).toHaveBeenLastCalledWith("profilePhotoTitle", "profilePhotoRemoveError");
  });
});
