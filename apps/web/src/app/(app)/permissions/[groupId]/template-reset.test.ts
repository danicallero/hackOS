import { describe, expect, it } from "vitest";
import { canResetPermissionTemplate } from "./template-reset";

describe("canResetPermissionTemplate", () => {
  it("requires wildcard authority only for the platform template", () => {
    expect(canResetPermissionTemplate("platform-administrator", [])).toBe(false);
    expect(canResetPermissionTemplate("platform-administrator", ["*"])).toBe(true);
    expect(canResetPermissionTemplate("queue-operator", [])).toBe(true);
  });
});
