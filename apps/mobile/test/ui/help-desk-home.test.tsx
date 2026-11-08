import { fireEvent, render, screen } from "@testing-library/react-native";
import { Pressable as MockPressable, Text as MockText, View as MockView } from "react-native";
import { HelpDeskScreen } from "@/components/help-desk/home-screen";

let mockCaps: string[] = [];
let mockEligible = false;
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 7, capabilities: mockCaps } }),
}));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/components/RequestFeedback", () => ({ RequestFeedback: () => null }));
jest.mock("@/components/native-ui", () => ({
  Section: ({ children }: { children: React.ReactNode }) => <MockView>{children}</MockView>,
  Separator: () => null,
}));
jest.mock("@/components/project-ui", () => ({
  NavRow: ({ title, onPress }: { title: string; onPress: () => void }) => (
    <MockPressable accessibilityRole="button" onPress={onPress}>
      <MockText>{title}</MockText>
    </MockPressable>
  ),
}));
jest.mock("@/components/segmented-control", () => ({
  SegmentedControl: ({
    values,
    onChange,
  }: {
    values: string[];
    onChange: (index: number) => void;
  }) => (
    <MockView>
      {values.map((value, index) => (
        <MockPressable key={value} accessibilityRole="tab" onPress={() => onChange(index)}>
          <MockText>{value}</MockText>
        </MockPressable>
      ))}
    </MockView>
  ),
}));
jest.mock("@/components/help-desk/requests-screen", () => ({
  HelpRequestList: ({ path }: { path: string }) => <MockText>{`list:${path}`}</MockText>,
}));
jest.mock("@/components/help-desk/primitives", () => ({
  HelpPage: ({ children }: { children: React.ReactNode }) => <MockView>{children}</MockView>,
  HelpText: ({ children }: { children: React.ReactNode }) => <MockText>{children}</MockText>,
  useHelpResource: () => ({
    data: { eligible: mockEligible },
    loading: false,
    error: null,
    load: jest.fn(),
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockEligible = false;
});

describe("Help desk tab root (H64-H67)", () => {
  it("defaults a participant to own and team requests with request actions", async () => {
    mockCaps = ["helpdesk:request"];
    await render(<HelpDeskScreen />);
    expect(screen.getByText("list:/api/helpdesk/requests/mine")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("helpRequest")).toBeTruthy();
    expect(screen.queryByText("helpCoverage")).toBeNull();
  });
  it("defaults a helper to the open inbox and offers claims and the helper profile", async () => {
    mockCaps = ["helpdesk:offer"];
    mockEligible = true;
    await render(<HelpDeskScreen />);
    expect(screen.getByText("list:/api/helpdesk/inbox?scope=open")).toBeTruthy();
    expect(screen.getByText("helpMyClaims")).toBeTruthy();
    expect(screen.queryByText("helpRequest")).toBeNull();
    await fireEvent.press(screen.getByText("helpMyProfile"));
    expect(mockPush).toHaveBeenCalledWith("/helper-profile");
  });
  it("lets a person with both capabilities switch between every list", async () => {
    mockCaps = ["helpdesk:request", "helpdesk:offer"];
    mockEligible = true;
    await render(<HelpDeskScreen />);
    expect(screen.getByText("list:/api/helpdesk/requests/mine")).toBeTruthy();
    await fireEvent.press(screen.getByText("helpAllRequests"));
    expect(screen.getByText("list:/api/helpdesk/inbox?scope=open")).toBeTruthy();
    await fireEvent.press(screen.getByText("helpMyClaims"));
    expect(screen.getByText("list:/api/helpdesk/inbox?scope=mine")).toBeTruthy();
  });
  it("shows coverage-only users the directory and coverage without request or helper actions", async () => {
    mockCaps = ["helpdesk:coverage"];
    await render(<HelpDeskScreen />);
    expect(screen.queryByText(/^list:/)).toBeNull();
    expect(screen.queryByText("helpRequest")).toBeNull();
    expect(screen.queryByText("helpMyProfile")).toBeNull();
    await fireEvent.press(screen.getByText("helpCoverage"));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/help-desk/coverage");
  });
});
