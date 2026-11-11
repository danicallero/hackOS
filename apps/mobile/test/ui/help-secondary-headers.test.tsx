import { render } from "@testing-library/react-native";

const mockHelpPage = jest.fn();
jest.mock("@/lib/auth-client", () => ({ authClient: {} }));
jest.mock("@/lib/api", () => ({ ApiError: class ApiError extends Error {}, apiFetch: jest.fn() }));
jest.mock("@/components/help-desk/primitives", () => ({
  HelpPage: (props: { children: unknown }) => {
    mockHelpPage(props);
    return props.children;
  },
  HelpText: () => null,
}));
jest.mock("@/components/help-desk/coverage-chart", () => ({ CoverageDayStrip: () => null }));
jest.mock("@/components/native-ui", () => ({
  EmptyState: () => null,
  InfoRow: () => null,
  Section: () => null,
  Separator: () => null,
}));
jest.mock("@/components/RequestFeedback", () => ({ RequestFeedback: () => null }));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 1, capabilities: ["helpdesk:coverage"] } }),
}));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key, language: "en" }) }));
jest.mock("@/lib/use-help-resource", () => ({
  useHelpResource: () => ({ data: null, error: null, loading: false, load: jest.fn() }),
}));
jest.mock("@/lib/event-time", () => ({ eventDayKey: () => "2026-11-08" }));
jest.mock("@/theme", () => ({
  colors: new Proxy({}, { get: () => "#000" }),
  space: new Proxy({}, { get: () => 8 }),
}));

import { HelpCoverageScreen } from "@/components/help-desk/coverage-screen";

describe("secondary help desk list pages use the tab's fixed header", () => {
  it("coverage asks for the fixed title, not a large one", async () => {
    await render(<HelpCoverageScreen />);
    expect(mockHelpPage).toHaveBeenCalledWith(
      expect.objectContaining({ title: "helpCoverage", fixedTitle: true }),
    );
  });
});
