import { render } from "@testing-library/react-native";
import CompanyTagLinkScreen from "@/app/s/[code]";
import { takePendingCompanyTag } from "@/lib/company-tag-link";

const mockReplace = jest.fn();
let mockParams: { code?: string } = {};
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ replace: mockReplace }),
}));
let mockSession: { authenticated: boolean; me: { capabilities: string[] } | null } = {
  authenticated: true,
  me: { capabilities: [] },
};
jest.mock("@/lib/me-context", () => ({ useMeContext: () => mockSession }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/theme/colors", () => ({
  colors: new Proxy({}, { get: (_target, key) => (key === "__esModule" ? false : "black") }),
}));

beforeEach(() => {
  mockReplace.mockReset();
  mockParams = { code: "04A1B2C3D4E5F6" };
  mockSession = { authenticated: true, me: { capabilities: [] } };
  takePendingCompanyTag();
});

describe("company-tag link route (#935)", () => {
  it("hands the code to the Diary's Companies album for a signed-in attendee", async () => {
    await render(<CompanyTagLinkScreen />);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/(tabs)/diary",
      params: { view: "companies", collect: "04A1B2C3D4E5F6" },
    });
    expect(takePendingCompanyTag()).toBeNull();
  });

  it("keeps the code for after sign-in when signed out", async () => {
    mockSession = { authenticated: false, me: null };
    await render(<CompanyTagLinkScreen />);
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
    expect(takePendingCompanyTag()).toBe("04A1B2C3D4E5F6");
  });
});
