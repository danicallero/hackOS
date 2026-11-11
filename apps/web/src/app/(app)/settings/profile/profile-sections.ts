import type { MessageKey } from "@/lib/i18n";
import { canOfferHelp } from "@/lib/mentor-profile";
import type { Me } from "@/lib/types";

type ProfileTabId = "public" | "mentoring" | "wallet" | "account";

export type ProfileSectionId =
  | "personal"
  | "public"
  | "mentor"
  | "share"
  | "rsvp"
  | "passes"
  | "certificates"
  | "security"
  | "roles"
  | "danger";

/** Sections with their own Save; their tab is marked while one holds unsaved edits. */
export type EditableSection = "personal" | "public" | "mentor" | "rsvp";

export interface SectionDef {
  id: ProfileSectionId;
  /** Omitted when the tab label already names the section. */
  title?: MessageKey;
}

interface TabDef {
  id: ProfileTabId;
  title: MessageKey;
  sections: SectionDef[];
}

const TABS: TabDef[] = [
  {
    id: "public",
    title: "publicProfileTitle",
    sections: [{ id: "public" }],
  },
  {
    id: "mentoring",
    title: "profileMentoringTitle",
    sections: [{ id: "mentor", title: "mentorProfileTitle" }],
  },
  {
    id: "wallet",
    title: "wallet",
    sections: [
      { id: "passes" },
      { id: "rsvp", title: "onboardingStepRsvp" },
      { id: "certificates", title: "certificates" },
      { id: "share", title: "onboardingStepShare" },
    ],
  },
  {
    id: "account",
    title: "accountTitle",
    sections: [
      { id: "personal", title: "personalDetails" },
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
 * section left is dropped. The help desk section follows the API's helper
 * eligibility, so an accepted mentor can prepare it before confirmation,
 * without event access (H61).
 */
export function visibleProfileTabs(
  me: Me,
  isPureApplicant: boolean,
  hasRsvps = false,
  helperEligible = false,
): TabDef[] {
  const visible = (id: ProfileSectionId) => {
    switch (id) {
      case "passes":
        return !isPureApplicant;
      case "certificates":
      case "public":
        return me.hasEventAccess;
      case "mentor":
        return (me.hasEventAccess && canOfferHelp(me)) || helperEligible;
      case "share":
        return me.hasEventAccess;
      case "rsvp":
        return me.hasEventAccess && hasRsvps;
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
