import {
  operationsSectionFromPathname,
  resolveOperationsNavigationAction,
} from "./operations-navigation";

describe("operations navigation", () => {
  it("treats queue, wallet, and account as their own pseudo-tabs", () => {
    expect(operationsSectionFromPathname("/(tabs)/others/queue")).toBe("queue");
    expect(operationsSectionFromPathname("/others/queue")).toBe("queue");
    expect(operationsSectionFromPathname("/(tabs)/others/wallet")).toBe("wallet");
    expect(operationsSectionFromPathname("/others/wallet")).toBe("wallet");
    expect(operationsSectionFromPathname("/(tabs)/others/account")).toBe("account");
    expect(operationsSectionFromPathname("/others/account")).toBe("account");
    expect(operationsSectionFromPathname("/schedule")).toBe("external");
    expect(operationsSectionFromPathname("/wallet")).toBe("external");
  });

  it("avoids stacking the same pseudo-tab twice", () => {
    expect(resolveOperationsNavigationAction("/(tabs)/others/queue", "/(tabs)/others/queue")).toBe(
      "noop",
    );
    expect(
      resolveOperationsNavigationAction("/(tabs)/others/wallet", "/(tabs)/others/wallet"),
    ).toBe("noop");
  });

  it("replaces across pseudo-tabs and returns to account without stacking", () => {
    expect(
      resolveOperationsNavigationAction("/(tabs)/others/account", "/(tabs)/others/queue"),
    ).toBe("replace");
    expect(resolveOperationsNavigationAction("/schedule", "/(tabs)/others/account")).toBe(
      "replace",
    );
    expect(resolveOperationsNavigationAction("/(tabs)/others/queue", "/(tabs)/others/wallet")).toBe(
      "replace",
    );
    expect(
      resolveOperationsNavigationAction("/(tabs)/others/queue", "/(tabs)/others/account"),
    ).toBe("replace");
  });
});
