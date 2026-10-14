import { renderHook } from "@testing-library/react-native";
import { Platform } from "react-native";
import { trueTopScrollStep, useTrueTopScroll } from "@/lib/use-true-top-scroll";

// The mobile tsconfig has no Node types; jest runs under Node.
const { readdirSync, readFileSync } = require("node:fs") as {
  readdirSync: (path: string) => string[];
  readFileSync: (path: string, encoding: "utf8") => string;
};
const { join } = require("node:path") as { join: (...parts: string[]) => string };
declare const __dirname: string;

const mockUseScrollToTop = jest.fn();
jest.mock("expo-router", () => ({
  useScrollToTop: (ref: unknown) => mockUseScrollToTop(ref),
}));

const event = (y: number) =>
  ({ nativeEvent: { contentOffset: { x: 0, y } } }) as Parameters<
    ReturnType<typeof useTrueTopScroll>["scrollProps"]["onScroll"]
  >[0];

describe("true-top scroll (#935)", () => {
  const initial = { top: 0, offset: 0, dragged: false, moving: false };

  it("takes the lowest offset before the first drag as the true top", () => {
    let state = trueTopScrollStep(initial, -62, "ios").state;
    expect(state.top).toBe(-62);
    // A pull-to-refresh after the first drag must not redefine it.
    state = trueTopScrollStep({ ...state, dragged: true }, -140, "ios").state;
    expect(state.top).toBe(-62);
  });

  it("flags iOS restoring a resting page to y 0 (raw-inset clamp) on iOS only", () => {
    const resting = { top: -62, offset: -62, dragged: true, moving: false };
    expect(trueTopScrollStep(resting, 0, "ios").restore).toBe(true);
    expect(trueTopScrollStep(resting, 0, "android").restore).toBe(false);
    // A user scroll through y 0 or a page away from its top is left alone.
    expect(trueTopScrollStep({ ...resting, moving: true }, 0, "ios").restore).toBe(false);
    expect(trueTopScrollStep({ ...resting, offset: 300 }, 0, "ios").restore).toBe(false);
  });

  it("scrolls a re-pressed tab to the true top, not y 0, and allows the negative offset", async () => {
    const scrollTo = jest.fn();
    const ref = { current: { scrollTo } };
    const { result } = await renderHook(() => useTrueTopScroll(ref));
    expect(result.current.scrollProps.scrollToOverflowEnabled).toBe(true);
    result.current.scrollProps.onScroll(event(-62));
    result.current.scrollProps.onScrollBeginDrag();
    result.current.scrollProps.onScroll(event(400));

    const topRef = mockUseScrollToTop.mock.calls.at(-1)[0];
    topRef.current.scrollToTop();
    expect(scrollTo).toHaveBeenLastCalledWith({ animated: true, y: -62 });
  });

  it("uses scrollToOffset for lists and puts a restored page back at its true top", async () => {
    const original = Platform.OS;
    Platform.OS = "ios";
    const scrollToOffset = jest.fn();
    const ref = { current: { scrollToOffset } };
    const { result } = await renderHook(() => useTrueTopScroll(ref));
    result.current.scrollProps.onScroll(event(-62));
    // Returning from the browser: iOS restores the clamped y 0 without a drag.
    result.current.scrollProps.onScroll(event(0));
    expect(scrollToOffset).toHaveBeenLastCalledWith({ animated: false, offset: -62 });
    Platform.OS = original;
  });

  it("routes every scroll-to-top screen through a true-top helper", () => {
    const root = join(__dirname, "../..");
    const files = [
      ...readdirSync(join(root, "components")).map((name) => join("components", name)),
      "components/my-queue-screen.tsx",
      "components/my-projects-screen.tsx",
    ].filter((file) => file.endsWith(".tsx"));
    // Account snaps through the profile-avatar hook, which targets the true top.
    const allowed = new Set([
      "useScrollToTop(topRef)",
      "useScrollToTop(avatarCollapse.scrollToTopRef)",
      // The alerts sheet is modal: no tab re-press reaches it.
      "useScrollToTop(scrollRef)@components/alerts-screen.tsx",
    ]);
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      if (!source.includes('contentInsetAdjustmentBehavior="automatic"')) continue;
      for (const call of source.match(/useScrollToTop\([^)]*\)/g) ?? []) {
        if (!allowed.has(call) && !allowed.has(`${call}@${file}`))
          offenders.push(`${file}: ${call}`);
      }
    }
    expect(offenders).toEqual([]);
    for (const file of [
      "components/my-queue-screen.tsx",
      "components/my-projects-screen.tsx",
      "components/activities-screen.tsx",
      "components/delete-account-screen.tsx",
      "components/diary-screen.tsx",
      "components/legal-screen.tsx",
      "components/others-hub-screen.tsx",
      "components/people-directory-screen.tsx",
      "components/person-operations-screen.tsx",
      "components/scan-log-screen.tsx",
      "components/stands-screen.tsx",
      "components/statistics-screen.tsx",
      "components/storage-screen.tsx",
      "components/sync-queue-screen.tsx",
      "components/wallet-screen.tsx",
    ]) {
      expect(readFileSync(join(root, file), "utf8")).toContain("{...trueTop.scrollProps}");
    }
  });
});
