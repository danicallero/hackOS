import { render } from "@testing-library/react-native";
import { EditionClosedNotice } from "@/components/edition-closed-notice";

let mockMe: unknown = null;
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, vars?: Record<string, string>) => `${key}:${vars?.name ?? ""}`,
  }),
}));
jest.mock("@/lib/me-context", () => ({ useMeContext: () => ({ me: mockMe }) }));
jest.mock("@/theme/colors", () => ({ colors: {} }));

const meIn = (status: string) => ({
  edition: { eventKey: "hackudc-2025", name: "HackUDC 2025", status, isCurrent: false },
});

it("shows one read-only notice naming a closed edition", async () => {
  mockMe = meIn("closed");
  const view = await render(<EditionClosedNotice />);
  expect(view.getByText("editionClosedNotice:HackUDC 2025")).toBeTruthy();
});

it("stays hidden for an active edition or an older server", async () => {
  mockMe = meIn("active");
  expect((await render(<EditionClosedNotice />)).queryByText(/editionClosedNotice/)).toBeNull();
  mockMe = {};
  expect((await render(<EditionClosedNotice />)).queryByText(/editionClosedNotice/)).toBeNull();
});
