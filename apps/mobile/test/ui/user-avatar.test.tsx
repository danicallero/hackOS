import { act, fireEvent, screen } from "@testing-library/react-native";
import { renderMobile } from "./render";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("@/lib/api", () => ({ getCurrentSessionCookie: () => "session=abc" }));
jest.mock("@/lib/env", () => ({ API_URL: "https://api.test/" }));

const { UserAvatar, avatarInitials } =
  require("@/components/user-avatar") as typeof import("@/components/user-avatar");

const loadEvent = { nativeEvent: { cacheType: "none", source: { url: "", width: 1, height: 1 } } };

describe("UserAvatar (#934)", () => {
  it("loads the private photo route with the session, in memory only, behind the initials", async () => {
    await renderMobile(
      <UserAvatar testID="avatar" name="Ada Lovelace" image="/api/users/7/photo?v=abc" />,
    );
    const photo = screen.getByTestId("avatar-photo", { includeHiddenElements: true });
    // expo-image sends the header on Android too (React Native's Image drops it).
    expect(photo.props.source).toEqual([
      expect.objectContaining({
        uri: "https://api.test/api/users/7/photo?v=abc",
        headers: { Cookie: "session=abc" },
        cacheKey: expect.stringMatching(
          /^[0-9a-z]+:https:\/\/api\.test\/api\/users\/7\/photo\?v=abc$/,
        ),
      }),
    ]);
    // The cache key tags the session without carrying the cookie.
    expect(photo.props.source[0].cacheKey).not.toContain("session=abc");
    expect(photo.props.cachePolicy).toBe("memory");
    // Initials stay until the photo has drawn.
    expect(screen.getByText("AL", { includeHiddenElements: true })).toBeTruthy();

    await act(async () => fireEvent(photo, "load", loadEvent));
    expect(screen.queryByText("AL", { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId("avatar-photo", { includeHiddenElements: true })).toBe(photo);
  });

  it("shows initials without a photo and when the photo fails to load", async () => {
    await renderMobile(<UserAvatar testID="avatar" name="Ada Lovelace" image={null} />);
    expect(screen.getByText("AL", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId("avatar-photo", { includeHiddenElements: true })).toBeNull();

    await renderMobile(<UserAvatar testID="broken" name="Grace" image="/api/users/8/photo" />);
    const photo = screen.getByTestId("broken-photo", { includeHiddenElements: true });
    await act(async () => fireEvent(photo, "error", { nativeEvent: { error: "404" } }));
    expect(screen.getByText("GR", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId("broken-photo", { includeHiddenElements: true })).toBeNull();
  });

  it("derives initials from the first and last words", () => {
    expect(avatarInitials("María José del Río")).toBe("MR");
    expect(avatarInitials("  ")).toBe("?");
    expect(avatarInitials("Ñandú")).toBe("ÑA");
  });
});
