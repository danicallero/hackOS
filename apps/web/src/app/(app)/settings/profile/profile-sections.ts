import type { MessageKey } from "@/lib/i18n";
import type { Me } from "@/lib/types";

export const PROFILE_PATH = "/settings/profile";

export type ProfileTabId = "personal" | "public" | "wallet" | "account";

export type ProfileSectionId =
  | "personal"
  | "public"
  | "meals"
  | "passes"
  | "certificates"
  | "security"
  | "roles"
  | "danger";

/** Sections with their own Save; their tab is marked while one holds unsaved edits. */
export type EditableSection = "personal" | "public" | "meals";

export interface SectionDef {
  id: ProfileSectionId;
  /** Omitted when the tab label already names the section. */
  title?: MessageKey;
}

export interface TabDef {
  id: ProfileTabId;
  title: MessageKey;
  sections: SectionDef[];
}

const TABS: TabDef[] = [
  {
    id: "personal",
    title: "personalDetails",
    sections: [{ id: "personal" }, { id: "meals", title: "meals" }],
  },
  { id: "public", title: "publicProfileTitle", sections: [{ id: "public" }] },
  {
    id: "wallet",
    title: "wallet",
    sections: [{ id: "passes" }, { id: "certificates", title: "certificates" }],
  },
  {
    id: "account",
    title: "accountTitle",
    sections: [
      { id: "security", title: "profileAccountSecurity" },
      { id: "roles", title: "rolesTitle" },
      { id: "danger", title: "dangerZone" },
    ],
  },
];

/**
 * The tabs and sections this account has. Passes follow the personal nav's
 * rule (hidden for pure applicants); certificates and the public profile need
 * current event access, as their APIs do (#934, #1083). A tab with no
 * section left is dropped.
 */
export function visibleProfileTabs(me: Me, isPureApplicant: boolean): TabDef[] {
  const visible = (id: ProfileSectionId) => {
    switch (id) {
      case "passes":
        return !isPureApplicant;
      case "certificates":
      case "public":
        return me.hasEventAccess;
      case "meals":
        return me.isSponsorRep;
      case "roles":
        return me.roles.length > 0;
      default:
        return true;
    }
  };
  return TABS.map((tab) => ({
    ...tab,
    sections: tab.sections.filter((s) => visible(s.id)),
  })).filter((tab) => tab.sections.length > 0);
}
