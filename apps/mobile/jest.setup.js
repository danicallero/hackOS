require("react-native-gesture-handler/jestSetup");

jest.mock("react-native-worklets", () => require("react-native-worklets/src/mock"));
// Native PDF renderer (#935 CV viewer): a plain view that keeps its props, so
// tests can read the rendered source without the native module.
jest.mock("react-native-pdf", () => {
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: (props) => require("react").createElement(View, { ...props, testID: "cv-viewer-pdf" }),
  };
});
// Skia has no native runtime under jest (#935 gooey merge): the canvas is a
// plain view that keeps its props, and the drawing primitives render nothing.
jest.mock("@shopify/react-native-skia", () => {
  const React = require("react");
  const { View } = require("react-native");
  const nothing = () => null;
  const path = { addCircle: () => path };
  return {
    Canvas: (props) => React.createElement(View, props),
    Group: nothing,
    Circle: nothing,
    Image: nothing,
    Text: nothing,
    Paint: nothing,
    Blur: nothing,
    ColorMatrix: nothing,
    matchFont: () => null,
    Skia: {
      Path: { Make: () => path },
      Data: { fromBase64: () => ({}), fromURI: async () => ({}) },
      Image: { MakeImageFromEncoded: () => null },
    },
  };
});
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
    useNativeGesture: () => chainableGesture(),
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

// #966: ActivityKit has no jest runtime. Live Activity factories behave like
// a device where none are running and starting one is refused.
jest.mock("expo-widgets", () => ({
  createLiveActivity: () => ({
    start: () => {
      throw new Error("Live Activities are unavailable in tests");
    },
    getInstances: () => [],
  }),
  createWidget: () => ({ reload() {}, updateTimeline() {}, updateSnapshot() {} }),
  addPushToStartTokenListener: () => ({ remove() {} }),
  addUserInteractionListener: () => ({ remove() {} }),
  after: (date) => ({ after: date }),
  widgetsDirectory: "",
}));

// Screen tests do not open SSE streams; they would pull the auth client into every render.
jest.mock("@/lib/use-stream-refresh", () => ({
  STREAM_REFRESH_JITTER_MS: 0,
  useStreamRefresh: () => () => true,
}));
