import { describe, expect, it } from "vitest";
import type { PublicScheduleItem } from "@/lib/logistics";
import {
  deriveScheduleCompanies,
  matchesScheduleCompanyFilter,
  scheduleLinksText,
} from "./schedule-company-filter";

const item = (id: number, enterprises: { id: number; name: string }[], speakers: string[] = []) =>
  ({
    id,
    enterprises: enterprises.map((e) => ({ ...e, logoUrl: null })),
    speakers: speakers.map((name, i) => ({ userId: i, name, avatarUrl: null })),
  }) as unknown as PublicScheduleItem;

describe("schedule company filter", () => {
  const items = [
    item(1, [{ id: 2, name: "Zeta" }], ["Ana Pérez"]),
    item(2, [
      { id: 1, name: "Acme" },
      { id: 2, name: "Zeta" },
    ]),
    item(3, []),
  ];

  it("derives distinct companies by name", () => {
    expect(deriveScheduleCompanies(items).map((c) => c.name)).toEqual(["Acme", "Zeta"]);
  });

  it("matches any selected company and everything when none is selected", () => {
    expect(
      items.filter((i) => matchesScheduleCompanyFilter(i, new Set(["1"]))).map((i) => i.id),
    ).toEqual([2]);
    expect(items.filter((i) => matchesScheduleCompanyFilter(i, new Set())).length).toBe(3);
  });

  it("makes speakers and companies searchable", () => {
    expect(scheduleLinksText(items[0])).toBe("Ana Pérez Zeta");
  });
});
