import { describe, expect, it } from "vitest";
import {
  canonicalStatisticsPanelKey,
  isCompatibleStatisticsPanel,
  panelDefinition,
  panelSupportsScope,
} from "../../src/modules/statistics/catalog.js";
import {
  parseStatisticsScopeKey,
  publicStatisticsScope,
  statisticsScopeKey,
} from "../../src/modules/statistics/service.js";

describe("generic statistics catalog", () => {
  it("canonicalizes the old time-series ids without creating duplicate panels", () => {
    expect(canonicalStatisticsPanelKey("submissions-by-day")).toBe("applications-over-time");
    expect(panelDefinition("confirmations-by-day")?.key).toBe("confirmations-over-time");
  });

  it("declares scope compatibility explicitly", () => {
    expect(isCompatibleStatisticsPanel("overview", ["application"])).toBe(true);
    expect(isCompatibleStatisticsPanel("overview", ["role"])).toBe(false);
    expect(isCompatibleStatisticsPanel("shirt-sizes", ["application", "role"])).toBe(true);
    expect(isCompatibleStatisticsPanel("field:gender", ["application", "role"])).toBe(false);
    expect(panelSupportsScope("field:gender", "application")).toBe(true);
    expect(panelSupportsScope("field:gender", "role")).toBe(false);
  });

  it("round-trips opaque scope resource keys", () => {
    expect(parseStatisticsScopeKey("role:42")).toEqual({ kind: "role", id: 42 });
    expect(parseStatisticsScopeKey("application:7")).toEqual({ kind: "application", id: 7 });
    expect(parseStatisticsScopeKey("role:nope")).toBeNull();
    expect(statisticsScopeKey("application", 7)).toBe("application:7");
  });

  it("does not serialize internal application rows with public scope metadata", () => {
    const internalScope = {
      key: "application:7",
      kind: "application" as const,
      id: 7,
      name: "Applications",
      panelKeys: ["overview"],
      application: { template: [{ key: "date_of_birth" }] },
    };
    expect(publicStatisticsScope(internalScope)).toEqual({
      key: "application:7",
      kind: "application",
      id: 7,
      name: "Applications",
      panelKeys: ["overview"],
    });
  });
});
