import { androidSymbolName } from "@/components/symbol";

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

  it("leaves unknown symbols available for the native fallback prop", () => {
    expect(androidSymbolName("future.symbol")).toBeUndefined();
  });
});
