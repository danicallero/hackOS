import { TAB_DEFINITIONS } from "@/components/opaque-router-tabs";
import { androidSymbolName } from "@/components/symbol";
import { OVERFLOW_TAB_ICON } from "@/lib/overflow-tabs";

// The tab bar reaches the auth client, whose ESM build Jest does not load here.
jest.mock("@/lib/auth-client", () => ({}));

describe("Android symbol aliases (H55)", () => {
  it.each([
    ["plus", "add"],
    ["plus.circle", "add_circle_outline"],
    ["arrow.down", "arrow_downward"],
    ["trash.fill", "delete"],
  ])("maps %s to a Material Symbol", (sfSymbol, materialSymbol) => {
    expect(androidSymbolName(sfSymbol)).toBe(materialSymbol);
  });

  it("keeps schedule and scanner aliases covered", () => {
    expect(androidSymbolName("calendar")).toBe("calendar_month");
    expect(androidSymbolName("lanyardcard")).toBe("badge");
    expect(androidSymbolName("building.2")).toBe("business");
    expect(androidSymbolName("clock.badge.exclamationmark.fill")).toBe("alarm");
  });

  it("covers the opaque tab bar icons", () => {
    expect(androidSymbolName("ellipsis")).toBe("more_horiz");
    expect(androidSymbolName("person.crop.circle")).toBe("account_circle");
    expect(androidSymbolName("rectangle.3.group")).toBe("dashboard");
    expect(androidSymbolName("wallet.pass")).toBe("account_balance_wallet");
    expect(androidSymbolName("person.2.crop.square.stack")).toBe("contacts");
  });

  it("maps every tab and overflow icon, so no tab renders blank on Android", () => {
    const icons = [
      ...Object.values(TAB_DEFINITIONS).flatMap((tab) => [tab.icon, tab.selectedIcon]),
      ...Object.values(OVERFLOW_TAB_ICON),
    ].filter((icon): icon is string => Boolean(icon));
    expect(icons.filter((icon) => !androidSymbolName(icon))).toEqual([]);
  });

  it("covers the diary favourite toggle", () => {
    expect(androidSymbolName("star")).toBe("star_border");
    expect(androidSymbolName("star.fill")).toBe("star");
  });

  it("maps bell.badge and bell.badge.fill to notifications icons", () => {
    expect(androidSymbolName("bell.badge")).toBe("notifications_none");
    expect(androidSymbolName("bell.badge.fill")).toBe("notifications");
  });

  it("leaves unknown symbols available for the native fallback prop", () => {
    expect(androidSymbolName("future.symbol")).toBeUndefined();
  });
});
