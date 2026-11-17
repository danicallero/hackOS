/**
 * Synchronous Reanimated stand-in for tab-bar screen tests: animations jump
 * to their target and report completion, so gesture callbacks run in order.
 * Use as `jest.mock("react-native-reanimated", () => require("./reanimated-mock").reanimatedMock())`.
 */
export function reanimatedMock() {
  const ReactLib = require("react");
  const Native = jest.requireActual("react-native");
  const settle = (v: number, _config?: unknown, done?: (finished: boolean) => void) => {
    done?.(true);
    return v;
  };
  return {
    __esModule: true,
    default: { View: Native.View, createAnimatedComponent: (c: unknown) => c },
    cancelAnimation: jest.fn(),
    runOnJS: (fn: (...args: never[]) => unknown) => fn,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => false,
    useSharedValue: (v: unknown) => ReactLib.useRef({ value: v }).current,
    withSpring: settle,
  };
}
