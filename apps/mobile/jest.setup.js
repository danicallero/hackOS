require("react-native-gesture-handler/jestSetup");

jest.mock("react-native-worklets", () => require("react-native-worklets/src/mock"));
jest.mock("react-native-reanimated", () => ({
  ...require("react-native-reanimated/mock"),
  useReducedMotion: () => false,
}));

// Real gesture recognition and worklet scheduling aren't meaningful under
// jest, and reanimated's official mock doesn't implement enough of the
// shared-value protocol (addListener/removeListener, isSharedValue) for
// gesture-handler's real Gesture/GestureDetector to run. Stand in with
// pass-through components, same as the community pattern for testing
// gesture-driven screens.
jest.mock("react-native-gesture-handler", () => {
  const actual = jest.requireActual("react-native-gesture-handler");
  const CHAINABLE_METHODS = [
    "enabled",
    "activeOffsetX",
    "activeOffsetY",
    "failOffsetX",
    "failOffsetY",
    "minDistance",
    "maxDistance",
    "maxDuration",
    "maxPointers",
    "hitSlop",
    "shouldCancelWhenOutside",
    "onBegin",
    "onStart",
    "onUpdate",
    "onChange",
    "onEnd",
    "onFinalize",
  ];
  function chainableGesture() {
    const gesture = {};
    for (const method of CHAINABLE_METHODS) gesture[method] = () => gesture;
    return gesture;
  }
  return {
    ...actual,
    Gesture: new Proxy({}, { get: () => chainableGesture }),
    GestureDetector: ({ children }) => children,
  };
});
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const React = require("react");
  const sharedValueStub = { value: 0 };
  // Renders the swipe actions statically (no swipe gesture) so tests can
  // reach them directly, instead of trying to simulate a real drag.
  return {
    __esModule: true,
    default: ({ children, renderLeftActions, renderRightActions }) =>
      React.createElement(
        React.Fragment,
        null,
        typeof renderLeftActions === "function"
          ? renderLeftActions(sharedValueStub, sharedValueStub, {})
          : null,
        children,
        typeof renderRightActions === "function"
          ? renderRightActions(sharedValueStub, sharedValueStub, {})
          : null,
      ),
  };
});
