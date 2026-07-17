import {
  operationsSectionFromPathname,
  resolveOperationsNavigationAction,
} from "./operations-navigation";

describe("operations navigation", () => {
  it("treats scanner and activities as their own pseudo-tabs", () => {
    expect(operationsSectionFromPathname("/(tabs)/others/scan")).toBe("scanner");
    expect(operationsSectionFromPathname("/others/scan")).toBe("scanner");
    expect(operationsSectionFromPathname("/(tabs)/others/scan/people")).toBe("scanner");
    expect(operationsSectionFromPathname("/others/scan/people")).toBe("scanner");
    expect(operationsSectionFromPathname("/(tabs)/others/activities")).toBe("activities");
    expect(operationsSectionFromPathname("/others/activities")).toBe("activities");
    expect(operationsSectionFromPathname("/(tabs)/others/account")).toBe("account");
    expect(operationsSectionFromPathname("/others/account")).toBe("account");
    expect(operationsSectionFromPathname("/schedule")).toBe("external");
    expect(operationsSectionFromPathname("/wallet")).toBe("external");
  });

  it("avoids stacking the same pseudo-tab twice", () => {
    expect(resolveOperationsNavigationAction("/(tabs)/others/scan", "/(tabs)/others/scan")).toBe(
      "noop",
    );
    expect(
      resolveOperationsNavigationAction("/(tabs)/others/activities", "/(tabs)/others/activities"),
    ).toBe("noop");
  });

  it("replaces across pseudo-tabs and returns to account without stacking", () => {
    expect(
      resolveOperationsNavigationAction("/(tabs)/others/account", "/(tabs)/others/scan"),
    ).toBe("replace");
    expect(resolveOperationsNavigationAction("/schedule", "/(tabs)/others/account")).toBe(
      "replace",
    );
    expect(
      resolveOperationsNavigationAction("/(tabs)/others/scan", "/(tabs)/others/activities"),
    ).toBe("replace");
    expect(
      resolveOperationsNavigationAction("/(tabs)/others/scan", "/(tabs)/others/account"),
    ).toBe("replace");
  });
});
