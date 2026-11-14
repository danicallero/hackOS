import { describe, expect, it } from "vitest";
import type { RoleSummary } from "@/lib/types";
import { filterRolesByName } from "./role-list";

const role = (id: number, name: string): RoleSummary => ({
  id,
  name,
  position: id,
  isVisible: true,
  eventAccess: false,
  isProtected: false,
  isSeeded: false,
  capabilities: [],
  memberIds: [],
  deletedAt: null,
});

describe("role name search", () => {
  it("matches without case or accent sensitivity", () => {
    const roles = [role(1, "José Núñez"), role(2, "Other")];
    expect(filterRolesByName(roles, "JOSE nunez")).toEqual([roles[0]]);
  });
});
