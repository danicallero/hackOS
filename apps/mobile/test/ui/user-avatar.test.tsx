import { act, fireEvent, screen } from "@testing-library/react-native";
import { renderMobile } from "./render";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("@/lib/api", () => ({ getCurrentSessionCookie: () => "session=abc" }));
jest.mock("@/lib/env", () => ({ API_URL: "https://api.test/" }));

const { UserAvatar } =
  require("@/components/user-avatar") as typeof import("@/components/user-avatar");

const loadEvent = { nativeEvent: { cacheType: "none", source: { url: "", width: 1, height: 1 } } };

describe("UserAvatar (#934)", () => {
  it("loads the private photo route with the session, in memory only, behind the mascot", async () => {
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
    // The assigned mascot stays until the photo has drawn.
    expect(screen.getByTestId("avatar-mascot", { includeHiddenElements: true })).toBeTruthy();

    await act(async () => fireEvent(photo, "load", loadEvent));
    expect(screen.queryByTestId("avatar-mascot", { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId("avatar-photo", { includeHiddenElements: true })).toBe(photo);
  });

  it("shows a mascot without a photo and when the private photo fails to load", async () => {
    await renderMobile(<UserAvatar testID="avatar" name="Ada Lovelace" image={null} />);
    expect(screen.getByTestId("avatar-mascot", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId("avatar-photo", { includeHiddenElements: true })).toBeNull();

    await renderMobile(<UserAvatar testID="broken" name="Grace" image="/api/users/8/photo" />);
    const photo = screen.getByTestId("broken-photo", { includeHiddenElements: true });
    await act(async () => fireEvent(photo, "error", { nativeEvent: { error: "404" } }));
    expect(screen.getByTestId("broken-mascot", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId("broken-photo", { includeHiddenElements: true })).toBeNull();
  });
});
