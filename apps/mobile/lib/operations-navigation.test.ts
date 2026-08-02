import {
  operationsSectionFromPathname,
  resolveOperationsNavigationAction,
} from "./operations-navigation";
import { OVERFLOW_TAB_KEYS, OVERFLOW_TAB_ROUTE } from "./overflow-tabs";

describe("operations navigation", () => {
  it("classifies every declared overflow destination with and without route groups", () => {
    for (const section of OVERFLOW_TAB_KEYS) {
      const route = OVERFLOW_TAB_ROUTE[section];
      expect(operationsSectionFromPathname(route)).toBe(section);
      expect(operationsSectionFromPathname(route.replace("/(tabs)", ""))).toBe(section);
    }
    expect(operationsSectionFromPathname("/schedule")).toBe("external");
    expect(operationsSectionFromPathname("/wallet")).toBe("external");
  });

  it("avoids stacking every declared pseudo-tab twice", () => {
    for (const section of OVERFLOW_TAB_KEYS) {
      const route = OVERFLOW_TAB_ROUTE[section];
      expect(resolveOperationsNavigationAction(route, route)).toBe("noop");
    }
  });

  it("replaces between every pair of distinct pseudo-tabs", () => {
    for (const currentSection of OVERFLOW_TAB_KEYS) {
      for (const targetSection of OVERFLOW_TAB_KEYS) {
        if (currentSection === targetSection) continue;
        expect(
          resolveOperationsNavigationAction(
            OVERFLOW_TAB_ROUTE[currentSection],
            OVERFLOW_TAB_ROUTE[targetSection],
          ),
        ).toBe("replace");
      }
    }
  });

  it("enters every pseudo-tab from outside the overflow stack", () => {
    for (const section of OVERFLOW_TAB_KEYS) {
      expect(resolveOperationsNavigationAction("/schedule", OVERFLOW_TAB_ROUTE[section])).toBe(
        "replace",
      );
    }
  });
});
