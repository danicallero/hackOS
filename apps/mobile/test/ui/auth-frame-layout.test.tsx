import { screen } from "@testing-library/react-native";
import { Dimensions, StyleSheet, View } from "react-native";
import { AuthScreen } from "@/components/auth-ui";
import { type SideRegion, SideRegionProvider } from "@/lib/side-region";
import { renderMobile } from "./render";

/**
 * H4/H55: the auth form's horizontal geometry on foldables. The book-pose crease comes from the
 * fold-region module in window points; the stack has already padded the system's side column.
 */

let mockRegion: { x: number; y: number; width: number; height: number } | null = null;
jest.mock("@/modules/fold-region", () => ({
  __esModule: true,
  default: { getDivisionRegion: () => mockRegion, getVerticalBarEdge: () => null },
}));

function setWindow(width: number, height: number) {
  const metrics = { width, height, scale: 3, fontScale: 1 };
  Dimensions.set({ window: metrics, screen: metrics });
}

type Box = { x: number; width: number };

/** Horizontal layout of the host Views from the screen down to `testID` (column flow, stretch). */
function formBox(testID: string, contentWidth: number): Box {
  const chain = [];
  for (let node = screen.getByTestId(testID).parent; node; node = node.parent) {
    if (typeof node.type === "string") chain.unshift(node);
  }
  let box = { x: 0, width: contentWidth };
  for (const node of chain) {
    const style = StyleSheet.flatten([node.props.style, node.props.contentContainerStyle]) ?? {};
    let { x, width } = box;
    if (typeof style.maxWidth === "number" && style.maxWidth < width) {
      if (style.alignSelf === "center") x += (width - style.maxWidth) / 2;
      width = style.maxWidth;
    }
    const left = Number(style.paddingLeft ?? style.paddingHorizontal ?? style.padding ?? 0);
    const right = Number(style.paddingRight ?? style.paddingHorizontal ?? style.padding ?? 0);
    box = { x: x + left, width: Math.max(0, width - left - right) };
  }
  return box;
}

async function renderAuth(scrollable: boolean, region: SideRegion) {
  await renderMobile(
    <SideRegionProvider value={region}>
      <AuthScreen scrollable={scrollable}>
        <View testID="form" />
      </AuthScreen>
    </SideRegionProvider>,
  );
}

const DUO_COLUMN: SideRegion = { edge: "right", size: 64 };
// iPhone Duo inner display, book pose: 951 × 669 pt window, crease down the middle.
const DUO_CREASE = { x: 471, y: 0, width: 9, height: 669 };

describe.each([
  ["fixed", false],
  ["scrollable", true],
])("%s AuthScreen geometry", (_name, scrollable) => {
  afterEach(() => {
    mockRegion = null;
  });

  it("keeps a readable form centred on the first page in a book pose", async () => {
    setWindow(951, 669);
    mockRegion = DUO_CREASE;
    await renderAuth(scrollable, DUO_COLUMN);
    // The stack pads the 64 pt column, leaving 887 pt; the first page ends at the crease.
    const form = formBox("form", 951 - 64);
    expect(form.width).toBeGreaterThanOrEqual(400);
    expect(form.x + form.width).toBeLessThanOrEqual(DUO_CREASE.x);
    expect(form.x + form.width / 2).toBeCloseTo(DUO_CREASE.x / 2, 0);
  });

  it("centres the form on the window beside the column when the Duo is flat", async () => {
    setWindow(951, 669);
    await renderAuth(scrollable, DUO_COLUMN);
    const form = formBox("form", 951 - 64);
    expect(form.width).toBe(440);
    expect(form.x + form.width / 2).toBeCloseTo(951 / 2, 0);
  });

  it.each([
    ["iPad landscape", 1366, 1024, { edge: "left", size: 64 } as SideRegion, 64],
    ["iPad portrait", 1024, 1366, { edge: null, size: 0 } as SideRegion, 0],
    ["Duo portrait", 669, 951, { edge: null, size: 0 } as SideRegion, 0],
  ])("centres a full-width form on %s", async (_label, width, height, region, padded) => {
    setWindow(width, height);
    await renderAuth(scrollable, region);
    const form = formBox("form", width - padded);
    expect(form.width).toBe(440);
    expect(padded + form.x + form.width / 2).toBeCloseTo(width / 2, 0);
  });

  it("fills a phone-width window inside its gutters", async () => {
    setWindow(390, 844);
    await renderAuth(scrollable, { edge: null, size: 0 });
    expect(formBox("form", 390)).toEqual({ x: 24, width: 342 });
  });
});
