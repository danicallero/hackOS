import { CAPABILITIES } from "@hackos/shared/capabilities";

/** H8: dedicated internal roles for synthetic Store-review operators. */
const STAFF_CAPABILITIES = [
  CAPABILITIES.ACCREDIT_SCAN,
  CAPABILITIES.PRESENCE_SCAN,
  CAPABILITIES.ACTIVITY_SCAN,
] as const;
/**
 * The queue operator runs the synthetic rooms and judges their projects. Every
 * queue and project route enforces the synthetic boundary for it (see
 * queue/fixture-boundary.ts), so these capabilities reach fixture data only.
 */
const QUEUE_OPERATOR_CAPABILITIES = [
  CAPABILITIES.QUEUE_STATUS,
  CAPABILITIES.QUEUE_OPERATE,
  CAPABILITIES.JUDGE_PANEL,
  CAPABILITIES.PROJECTS_READ,
  CAPABILITIES.PROJECTS_EDIT,
] as const;
export const REVIEW_FIXTURE_ROLES = {
  "staff-exit-operator": {
    name: "App review exit staff",
    position: -900000,
    capabilities: STAFF_CAPABILITIES,
  },
  "staff-queue-operator": {
    name: "App review queue staff",
    position: -900001,
    capabilities: QUEUE_OPERATOR_CAPABILITIES,
  },
} as const;
