import { act, screen, userEvent } from "@testing-library/react-native";

jest.mock("expo-router", () => ({ useFocusEffect: () => {}, useScrollToTop: () => {} }));
jest.mock("@/components/RequestFeedback", () => ({ RequestFeedback: () => null }));
jest.mock("@/components/stale-data-banner", () => ({ StaleDataBanner: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string) =>
      ({
        queueHowItWorksBack: "Back",
        queueHowItWorksDone: "Done",
        queueHowItWorksDoorBody: "Wait outside the room until you are called in.",
        queueHowItWorksDoorNote: "Near the top of another queue? No action needed.",
        queueHowItWorksDoorTitle: "2. Wait at the door",
        queueHowItWorksEnterBody: "Enter after an explicit notification or staff instruction.",
        queueHowItWorksEnterTitle: "3. Enter now",
        queueHowItWorksIntro: "The queue has three stages.",
        queueHowItWorksNext: "Next",
        queueHowItWorksPrepareBody: "Get your team ready, but do not go to the room yet.",
        queueHowItWorksPrepareTitle: "1. Get ready",
        queueHowItWorksSkip: "Skip",
        queueHowItWorksTitle: "How the queue works",
        queueEmpty: "Once your project joins a judging queue, your live status will appear here.",
        queueEmptyTitle: "Not in a queue yet",
      })[key] ?? key,
  }),
}));
jest.mock("@/lib/me-context", () => ({ useMeContext: () => ({ me: { id: 1 } }) }));
jest.mock("@/lib/notification-events", () => ({ subscribeToCategory: () => () => {} }));
jest.mock("@/lib/queue-tutorial", () => ({
  hasSeenQueueTutorial: () => Promise.resolve(true),
  markQueueTutorialSeen: () => Promise.resolve(),
}));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarScrollBottomInset: () => 0 }));
jest.mock("@/lib/server-events", () => ({ subscribeToServerEvent: () => () => {} }));
jest.mock("@/lib/use-android-top-inset", () => ({ useAndroidTopInset: () => 0 }));
jest.mock("@/lib/use-cached-api", () => ({
  useCachedApi: () => ({
    data: [],
    error: null,
    load: jest.fn(),
    loading: false,
    staleSince: null,
  }),
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    accentSurface: "#eaf2ff",
    background: "#f5f5f7",
    label: "#171717",
    onAccentSurface: "#12345c",
    primaryAction: "#0057b8",
    primaryActionText: "#ffffff",
    secondaryLabel: "#5f6368",
    separator: "#d1d1d6",
    surface: "#ffffff",
  },
}));

import QueueScreen, { QueueTutorial } from "@/app/(tabs)/queue";
import { renderMobile } from "./render";

describe("queue tutorial (H38)", () => {
  it("keeps the tutorial available from the no-queue state", async () => {
    await renderMobile(<QueueScreen />);

    expect(screen.getByRole("header", { name: "Not in a queue yet" })).toBeTruthy();
    expect(screen.getByTestId("queue-tutorial-open")).toBeTruthy();
  });

  it("moves through the three distinct instructions and finishes from the fixed actions", async () => {
    const onDismiss = jest.fn();
    const user = userEvent.setup();
    await renderMobile(
      <QueueTutorial visible bottomInset={34} topInset={47} onDismiss={onDismiss} />,
    );

    expect(screen.getByText("1. Get ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

    await user.press(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2. Wait at the door")).toBeTruthy();

    await user.press(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("3. Enter now")).toBeTruthy();

    await user.press(screen.getByRole("button", { name: "Done" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("only enables scrolling when measured content exceeds the available viewport", async () => {
    await renderMobile(
      <QueueTutorial visible bottomInset={34} topInset={47} onDismiss={jest.fn()} />,
    );

    let scrollView = screen.getByTestId("queue-tutorial-scroll");
    expect(scrollView).toHaveProp("scrollEnabled", false);
    expect(scrollView).toHaveProp("showsVerticalScrollIndicator", false);

    await act(async () => {
      scrollView.props.onLayout({ nativeEvent: { layout: { height: 500 } } });
      scrollView.props.onContentSizeChange(300, 480);
    });
    scrollView = screen.getByTestId("queue-tutorial-scroll");
    expect(scrollView).toHaveProp("scrollEnabled", false);
    expect(scrollView).toHaveProp("showsVerticalScrollIndicator", false);

    await act(async () => scrollView.props.onContentSizeChange(300, 560));
    scrollView = screen.getByTestId("queue-tutorial-scroll");
    expect(scrollView).toHaveProp("scrollEnabled", true);
    expect(scrollView).toHaveProp("showsVerticalScrollIndicator", true);

    await act(async () => scrollView.props.onLayout({ nativeEvent: { layout: { height: 600 } } }));
    scrollView = screen.getByTestId("queue-tutorial-scroll");
    expect(scrollView).toHaveProp("scrollEnabled", false);
    expect(scrollView).toHaveProp("showsVerticalScrollIndicator", false);
  });
});
