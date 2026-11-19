import { StyleSheet } from "react-native";
import { IMAGE_FADE_MS, PersonAvatar } from "@/components/person-avatar";
import { colors } from "@/theme/colors";
import { renderMobile } from "./render";

let mockDark = true;
let mockBleed = false;
jest.mock("@/components/useColorScheme", () => ({
  useColorScheme: () => (mockDark ? "dark" : "light"),
}));
jest.mock("@/lib/api", () => ({ getCurrentSessionCookie: () => "" }));
jest.mock("@/lib/env", () => ({ API_URL: "https://api.test" }));
jest.mock("@/lib/image-tint", () => ({
  prefetchImageTint: jest.fn(),
  useImageBleed: () => mockBleed,
}));

beforeEach(() => {
  mockDark = true;
  mockBleed = false;
});

it.each([true, false])("selects the company artwork for dark=%s", async (dark) => {
  mockDark = dark;
  const view = await renderMobile(
    <PersonAvatar
      testID="avatar"
      size={40}
      kind="sponsor"
      uri="https://logo/light.png"
      logoNegativeUrl="https://logo/dark.png"
    />,
  );
  const image = view.getByTestId("avatar-image", { includeHiddenElements: true });
  expect(image.props.source).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ uri: dark ? "https://logo/dark.png" : "https://logo/light.png" }),
    ]),
  );
});

it("keeps positive-only logos on white in dark mode", async () => {
  const view = await renderMobile(
    <PersonAvatar testID="avatar" size={40} kind="sponsor" uri="https://logo/light.png" />,
  );
  expect(StyleSheet.flatten(view.getByTestId("avatar").props.style).backgroundColor).toBe(
    colors.accentText,
  );
});

it.each([true, false])("adds margin only to edge-touching artwork: %s", async (bleed) => {
  mockBleed = bleed;
  const view = await renderMobile(
    <PersonAvatar testID="avatar" size={40} kind="sponsor" uri="https://logo/light.png" />,
  );
  expect(
    StyleSheet.flatten(
      view.getByTestId("avatar-image", { includeHiddenElements: true }).props.style,
    ).width,
  ).toBe(bleed ? 33.6 : 40);
});

it("preserves cropped person photos", async () => {
  mockBleed = true;
  const view = await renderMobile(
    <PersonAvatar testID="avatar" size={40} uri="https://photo/person.png" />,
  );
  const image = view.getByTestId("avatar-image", { includeHiddenElements: true });
  expect(image.props.contentFit).toBe("cover");
  expect(StyleSheet.flatten(image.props.style).width).toBe(40);
});

it("dissolves the photo over its initials from the shared in-memory request (#935)", async () => {
  const view = await renderMobile(
    <PersonAvatar testID="avatar" size={40} name="Iria Test" uri="/api/users/9/photo?v=1" />,
  );
  const image = view.getByTestId("avatar-image", { includeHiddenElements: true });
  // Visible from the start, so expo-image's own transition fades it in over the initials.
  expect(StyleSheet.flatten(image.props.style).opacity).toBeUndefined();
  expect(image.props.transition).toEqual({ duration: IMAGE_FADE_MS });
  expect(image.props.cachePolicy).toBe("memory");
  expect(JSON.stringify(image.props.source)).toContain("https://api.test/api/users/9/photo?v=1");
  expect(view.getByText("IT")).toBeTruthy();
});
