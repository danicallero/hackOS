import { act, fireEvent, screen } from "@testing-library/react-native";
import { CompanyProfileScreen } from "@/components/company-profile-screen";
import { resetStatusNoticeAttempts } from "@/components/status-notice";
import { ApiError, apiFetch } from "@/lib/api";
import type { CompanyProfile } from "@/lib/company";
import { clearProfileSeeds, companySeed, personSeed, seedCompanies } from "@/lib/profile-seed";
import { renderMobile } from "./render";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "5" }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  Link: require("./mock-link").makeLink((href: unknown) => mockPush(href)),
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, push: mockPush }),
}));
jest.mock("expo-router/stack", () => ({ __esModule: true, default: { Screen: () => null } }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({ language: "en", t: (key: string) => key }),
}));
jest.mock("@/lib/env", () => ({ API_URL: "https://api.test" }));
jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
  getCurrentSessionCookie: () => "session=1",
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
  isRealLiquidGlassAvailable: () => false,
}));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/image-tint", () => ({
  prefetchImageTint: jest.fn(),
  useImageBleed: () => false,
  useImageTint: () => ({ color: null, settled: true, fromCache: true }),
}));

jest.mock("@/theme/colors", () => ({
  colors: new Proxy({}, { get: (_target, key) => (key === "__esModule" ? false : "black") }),
}));

// Made-up company and people (no real data in fixtures).
const company: CompanyProfile = {
  id: 5,
  name: "Proba Labs",
  logoUrl: "https://cdn.test/proba.png",
  logoNegativeUrl: null,
  website: "https://proba.test",
  description: "We build test rigs.",
  representatives: [
    { userId: 9, name: "Iria Test", firstName: "Iria", surname: "Test", avatarUrl: null },
  ],
  challenges: [],
  activities: [],
};

let companyResult: CompanyProfile | Error;
let release: (() => void) | null;

beforeEach(() => {
  clearProfileSeeds();
  resetStatusNoticeAttempts();
  companyResult = company;
  release = null;
  jest.mocked(apiFetch).mockReset();
  jest.mocked(apiFetch).mockImplementation(async (path: string) => {
    if (path === "/api/enterprises/5/profile") {
      if (release === null) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      if (companyResult instanceof Error) throw companyResult;
      return companyResult;
    }
    if (path === "/api/me/diary/sponsors") return { total: 0, collected: 0, items: [] };
    return undefined;
  });
});

async function arrive() {
  await act(async () => {
    release?.();
  });
}

it("draws the seeded logo and name with skeletons before the profile arrives (H44, #935)", async () => {
  seedCompanies([{ id: 5, name: "Proba Labs", logoUrl: company.logoUrl }]);
  await renderMobile(<CompanyProfileScreen />);
  expect(screen.getByText("Proba Labs")).toBeTruthy();
  expect(screen.getByTestId("company-hero")).toBeTruthy();
  expect(screen.getByTestId("company-profile-skeleton")).toBeTruthy();
  expect(screen.queryByText("We build test rigs.")).toBeNull();

  await arrive();
  expect(await screen.findAllByText("We build test rigs.")).not.toHaveLength(0);
  expect(screen.queryByTestId("company-profile-skeleton")).toBeNull();
  expect(screen.getAllByText("Proba Labs")).toHaveLength(1);
  // Its representatives open on what this page showed.
  expect(personSeed(9)?.displayName).toBe("Iria Test");
  expect(companySeed(5)?.name).toBe("Proba Labs");
});

it("shows the page's shape without a seed", async () => {
  await renderMobile(<CompanyProfileScreen />);
  expect(screen.getByTestId("company-profile-skeleton")).toBeTruthy();
  expect(screen.queryByText("Proba Labs")).toBeNull();
  await arrive();
  expect(await screen.findByText("Proba Labs")).toBeTruthy();
});

it("keeps the seeded header when the rest fails, then retries", async () => {
  seedCompanies([{ id: 5, name: "Proba Labs", logoUrl: null }]);
  companyResult = new Error("offline");
  release = () => undefined;
  await renderMobile(<CompanyProfileScreen />);
  expect(await screen.findByText("profileRestError")).toBeTruthy();
  expect(screen.getByText("Proba Labs")).toBeTruthy();

  companyResult = company;
  await fireEvent.press(screen.getByRole("button", { name: "retry" }));
  expect(await screen.findAllByText("We build test rigs.")).not.toHaveLength(0);
  expect(screen.queryByText("profileRestError")).toBeNull();
});

it("shows not available for a hidden company, even with a seed", async () => {
  seedCompanies([{ id: 5, name: "Proba Labs", logoUrl: null }]);
  companyResult = new ApiError("Not found", 404);
  release = () => undefined;
  await renderMobile(<CompanyProfileScreen />);
  expect(await screen.findByText("companyNotFound")).toBeTruthy();
  expect(screen.queryByText("Proba Labs")).toBeNull();
});
