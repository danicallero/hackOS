import { ALL_CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import type { RoleTemplate } from "@/lib/types";
import {
  capabilitiesByDomain,
  permissionTemplateDescription,
  permissionTemplateName,
  selectableCapabilities,
  templateRequiresWildcardAuthority,
} from "./helpers";

describe("permission helpers", () => {
  it("does not offer the deprecated sponsor portal capability", () => {
    expect(ALL_CAPABILITIES).toContain("sponsor:portal");
    expect(selectableCapabilities()).not.toContain("sponsor:portal");
  });

  it("keeps the deprecated sponsor portal capability out of the visible catalogue", () => {
    expect(capabilitiesByDomain().flatMap((group) => group.capabilities)).not.toContain(
      "sponsor:portal",
    );
  });

  it("uses the catalogue's label keys and recognizes wildcard authority", () => {
    const template: RoleTemplate = {
      key: "platform-administrator",
      labelKey: "permissionTemplatePlatformAdministrator",
      descriptionKey: "permissionTemplatePlatformAdministratorDescription",
      capabilities: ["*"],
    };
    const t = (key: string) => `translated:${key}`;

    expect(permissionTemplateName(template, t)).toBe(
      "translated:permissionTemplatePlatformAdministrator",
    );
    expect(permissionTemplateDescription(template, t)).toBe(
      "translated:permissionTemplatePlatformAdministratorDescription",
    );
    expect(templateRequiresWildcardAuthority(template)).toBe(true);
  });
});
