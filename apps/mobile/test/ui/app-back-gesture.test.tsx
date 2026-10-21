import { act, render } from "@testing-library/react-native";
import { AppBackGesture, useBackDismiss } from "@/components/app-back-gesture";

const mockBack = jest.fn();
let mockCanGoBack = true;
let mockDown: (event: unknown, manager: unknown) => void;
let mockEnd: (event: unknown) => void;
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => mockCanGoBack }),
}));
jest.mock("@/lib/vertical-bar-edge", () => ({ useSideInsets: () => ({ left: 200, right: 0 }) }));
jest.mock("react-native-gesture-handler", () => ({
  Gesture: {
    Pan: () => {
      const gesture = {
        enabled: () => gesture,
        runOnJS: () => gesture,
        activeOffsetX: () => gesture,
        failOffsetX: () => gesture,
        failOffsetY: () => gesture,
        onTouchesDown: (fn: typeof mockDown) => {
          mockDown = fn;
          return gesture;
        },
        onEnd: (fn: typeof mockEnd) => {
          mockEnd = fn;
          return gesture;
        },
      };
      return gesture;
    },
  },
  GestureDetector: ({ children }: { children: unknown }) => children,
}));

beforeEach(() => {
  mockBack.mockClear();
  mockCanGoBack = true;
});
it("accepts a right swipe from the sidebar, leaving ordinary content to the native stack", async () => {
  await render(<AppBackGesture>{null}</AppBackGesture>);
  const fail = jest.fn();
  mockDown({ allTouches: [{ x: 40, y: 200 }] }, { fail });
  expect(fail).not.toHaveBeenCalled();
  await act(() => mockEnd({ translationX: 80 }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  mockDown({ allTouches: [{ x: 300, y: 200 }] }, { fail });
  expect(fail).toHaveBeenCalledTimes(1);
});
it("closes an open overlay before navigating and rejects a short swipe", async () => {
  const close = jest.fn();
  function Overlay() {
    useBackDismiss(true, close);
    return null;
  }
  await render(
    <AppBackGesture>
      <Overlay />
    </AppBackGesture>,
  );
  await act(() => mockEnd({ translationX: 20 }));
  expect(close).not.toHaveBeenCalled();
  await act(() => mockEnd({ translationX: 90 }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(mockBack).not.toHaveBeenCalled();
});
it("does not take the dock gesture when there is nowhere to go back", async () => {
  mockCanGoBack = false;
  await render(<AppBackGesture>{null}</AppBackGesture>);
  const fail = jest.fn();
  mockDown({ allTouches: [{ x: 20, y: 200 }] }, { fail });
  expect(fail).toHaveBeenCalledTimes(1);
});
