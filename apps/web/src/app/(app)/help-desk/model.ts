import type { HelpRequest } from "@hackos/shared/help-desk";
import type { MessageKey } from "@/lib/i18n";

export type {
  AvailabilityInterval,
  CoverageReport,
  HelperCard,
  HelperDetail,
  HelpRequest,
  HelpTopic,
  MyHelperProfile,
} from "@hackos/shared/help-desk";
export { validAvailability } from "@hackos/shared/help-desk";

export const REQUEST_STATUS: Record<HelpRequest["status"], MessageKey> = {
  open: "helpDeskOpen",
  claimed: "helpDeskClaimed",
  resolved: "helpDeskResolved",
  cancelled: "helpDeskCancelled",
};
