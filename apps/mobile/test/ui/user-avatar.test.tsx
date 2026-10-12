import { act, screen } from "@testing-library/react-native";
import { renderMobile } from "./render";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockLoadApiImage = jest.fn<Promise<string>, [string]>();
jest.mock("@/lib/api", () => ({ getCurrentSessionCookie: () => "session=abc" }));
jest.mock("@/lib/directory", () => ({
  loadApiImage: (path: string) => mockLoadApiImage(path),
}));

const { UserAvatar, avatarInitials } =
  require("@/components/user-avatar") as typeof import("@/components/user-avatar");

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("UserAvatar (#934)", () => {
  beforeEach(() => {
    mockLoadApiImage.mockReset();
  });

  it("fetches the private photo route with the session and shows it from memory", async () => {
    // An `Image` source with a Cookie header answers 401 on Android, so the
    // photo must go through the session-aware loader, never `source.headers`.
    mockLoadApiImage.mockResolvedValue("data:image/jpeg;base64,AAAA");
    await renderMobile(
      <UserAvatar testID="avatar" name="Ada Lovelace" image="/api/users/7/photo?v=abc" />,
    );
    await flush();
    expect(mockLoadApiImage).toHaveBeenCalledWith("/api/users/7/photo?v=abc");
    expect(
      screen.getByTestId("avatar-photo", { includeHiddenElements: true }).props.source,
    ).toEqual({ uri: "data:image/jpeg;base64,AAAA" });
    expect(screen.queryByText("AL", { includeHiddenElements: true })).toBeNull();
  });

  it("shows initials without a photo and when the photo fails to load", async () => {
    await renderMobile(<UserAvatar testID="avatar" name="Ada Lovelace" image={null} />);
    expect(screen.getByText("AL", { includeHiddenElements: true })).toBeTruthy();
    expect(mockLoadApiImage).not.toHaveBeenCalled();

    mockLoadApiImage.mockRejectedValue(new Error("Photo request failed (404)"));
    await renderMobile(<UserAvatar testID="broken" name="Grace" image="/api/users/8/photo" />);
    await flush();
    expect(screen.getByText("GR", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId("broken-photo", { includeHiddenElements: true })).toBeNull();
  });

  it("derives initials from the first and last words", () => {
    expect(avatarInitials("María José del Río")).toBe("MR");
    expect(avatarInitials("  ")).toBe("?");
    expect(avatarInitials("Ñandú")).toBe("ÑA");
  });
});
