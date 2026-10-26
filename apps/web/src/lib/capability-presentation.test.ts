import { ALL_CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { capabilitiesByDomain, selectableCapabilities } from "./capability-presentation";

describe("capability presentation", () => {
  it("exposes the complete current capability catalogue", () => {
    expect(selectableCapabilities()).toEqual(ALL_CAPABILITIES);
    const groupedCapabilities = capabilitiesByDomain().flatMap((group) => group.capabilities);
    expect(groupedCapabilities).toHaveLength(ALL_CAPABILITIES.length);
    expect(new Set(groupedCapabilities)).toEqual(new Set(ALL_CAPABILITIES));
  });
});
