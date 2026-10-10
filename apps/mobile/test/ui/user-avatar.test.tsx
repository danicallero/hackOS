import { act, fireEvent, screen } from "@testing-library/react-native";
import { renderMobile } from "./render";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let mockCookie = "better-auth.session_token=abc";
jest.mock("@/lib/api", () => ({ getCurrentSessionCookie: () => mockCookie }));
jest.mock("@/lib/env", () => ({ API_URL: "https://api.example/" }));

const { UserAvatar, avatarInitials, authenticatedImageSource } =
  require("@/components/user-avatar") as typeof import("@/components/user-avatar");

describe("UserAvatar (#934)", () => {
  beforeEach(() => {
    mockCookie = "better-auth.session_token=abc";
  });

  it("loads the private photo route with the session cookie", async () => {
    await renderMobile(
      <UserAvatar testID="avatar" name="Ada Lovelace" image="/api/users/7/photo?v=abc" />,
    );
    expect(
      screen.getByTestId("avatar-photo", { includeHiddenElements: true }).props.source,
    ).toEqual({
      uri: "https://api.example/api/users/7/photo?v=abc",
      headers: { cookie: "better-auth.session_token=abc" },
    });
    expect(screen.queryByText("AL", { includeHiddenElements: true })).toBeNull();
  });

  it("shows initials without a photo and when the photo fails to load", async () => {
    await renderMobile(<UserAvatar testID="avatar" name="Ada Lovelace" image={null} />);
    expect(screen.getByText("AL", { includeHiddenElements: true })).toBeTruthy();

    await renderMobile(<UserAvatar testID="broken" name="Grace" image="/api/users/8/photo" />);
    await act(async () => {
      fireEvent(screen.getByTestId("broken-photo", { includeHiddenElements: true }), "error");
    });
    expect(screen.getByText("GR", { includeHiddenElements: true })).toBeTruthy();
  });

  it("keeps absolute URLs and omits an empty cookie", () => {
    mockCookie = "";
    expect(authenticatedImageSource("https://cdn.example/a.png")).toEqual({
      uri: "https://cdn.example/a.png",
    });
  });

  it("derives initials from the first and last words", () => {
    expect(avatarInitials("María José del Río")).toBe("MR");
    expect(avatarInitials("  ")).toBe("?");
    expect(avatarInitials("Ñandú")).toBe("ÑA");
  });
});
