jest.mock("@/theme/colors", () => ({
  colors: new Proxy({}, { get: (_target, key) => (key === "__esModule" ? false : "black") }),
}));

import { paneRootHeaderOptions, screenTitleElement } from "@/lib/screen-header-options";
import { SCREEN_TITLE } from "@/theme/screen-title";

describe("pane header options (H55)", () => {
  it("draws the title as plain SCREEN_TITLE text without a shared glass capsule", () => {
    const options = paneRootHeaderOptions({ title: "Scanner", trailing: null });
    const [title] = options.unstable_headerLeftItems() as Array<{
      element: { props: { style: unknown; children: unknown } };
      hidesSharedBackground: boolean;
    }>;
    expect(title?.hidesSharedBackground).toBe(true);
    expect(title?.element.props.style).toMatchObject(SCREEN_TITLE);
    expect(title?.element.props.children).toBe("Scanner");
    expect(options.headerShadowVisible).toBe(false);
    expect(options.title).toBe("");
  });

  it("uses the same title element as every other top-level title", () => {
    expect((screenTitleElement("Scanner").props as { style: unknown }).style).toMatchObject({
      fontSize: SCREEN_TITLE.fontSize,
      fontWeight: SCREEN_TITLE.fontWeight,
      lineHeight: SCREEN_TITLE.lineHeight,
    });
  });
});
