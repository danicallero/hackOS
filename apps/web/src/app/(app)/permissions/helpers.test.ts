import { ALL_CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import type { RoleGrantRule, RoleTemplate } from "@/lib/types";
import {
  capabilitiesByDomain,
  permissionTemplateDescription,
  permissionTemplateName,
  ruleTriggerLabel,
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

  it("labels a role-assignment-triggered rule by its source role, not the (null) trigger_event (H8, 0812)", () => {
    // Mimics the real catalogue entry ("{roleName} is assigned") closely
    // enough to exercise interpolation without importing the JSON locale.
    const t = (key: string, values?: Record<string, string | number>) => {
      const template = key === "triggerSourceRoleAssigned" ? "{roleName} is assigned" : key;
      return values
        ? Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), template)
        : template;
    };
    const rule: Pick<RoleGrantRule, "triggerEvent" | "sourceRoleId" | "sourceRoleName"> = {
      triggerEvent: null,
      sourceRoleId: 7,
      sourceRoleName: "Event Director",
    };
    expect(ruleTriggerLabel(rule, t)).toBe("Event Director is assigned");
  });

  it("falls back to the trigger_event label when sourceRoleId is unset", () => {
    const t = (key: string) => key;
    const rule: Pick<RoleGrantRule, "triggerEvent" | "sourceRoleId" | "sourceRoleName"> = {
      triggerEvent: "sponsor.enterprise_linked",
      sourceRoleId: null,
      sourceRoleName: null,
    };
    expect(ruleTriggerLabel(rule, t)).toBe("triggerEventSponsorEnterpriseLinked");
  });
});
