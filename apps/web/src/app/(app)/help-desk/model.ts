import type { HelpRequest as ApiHelpRequest } from "@hackos/shared/help-desk";
import type { DirectoryEntry } from "@/lib/directory";
import type { MessageKey } from "@/lib/i18n";

export type {
  AvailabilityInterval,
  CoverageReport,
  HelpChallengeOption,
  HelperCard,
  HelperDetail,
  HelpTopic,
  MyHelperProfile,
} from "@hackos/shared/help-desk";
export { validAvailability } from "@hackos/shared/help-desk";

/** A request as it is read here: `requesterProfile` is the requester's public profile, null when not shared. */
export type HelpRequest = ApiHelpRequest & { requesterProfile?: DirectoryEntry | null };

export const REQUEST_STATUS: Record<HelpRequest["status"], MessageKey> = {
  open: "helpDeskWaiting",
  claimed: "helpDeskClaimed",
  resolved: "helpDeskResolved",
  cancelled: "helpDeskCancelled",
};
