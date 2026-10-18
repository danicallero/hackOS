import type { ActivityKind } from "@hackos/shared/activity-kinds";

/** H47: category identity is shared by grid, agenda and filter markers in both themes. */
export const SCHEDULE_CATEGORY_STYLES = {
  activity:
    "border-schedule-activity/40 border-l-schedule-activity bg-schedule-activity/10 text-foreground",
  meal: "border-schedule-meal/40 border-l-schedule-meal bg-schedule-meal/10 text-foreground",
  workshop:
    "border-schedule-workshop/40 border-l-schedule-workshop bg-schedule-workshop/10 text-foreground",
  talk: "border-schedule-talk/40 border-l-schedule-talk bg-schedule-talk/10 text-foreground",
  ceremony:
    "border-schedule-ceremony/40 border-l-schedule-ceremony bg-schedule-ceremony/10 text-foreground",
  deadline:
    "border-schedule-deadline/40 border-l-schedule-deadline bg-schedule-deadline/10 text-foreground",
  other: "border-schedule-other/40 border-l-schedule-other bg-schedule-other/10 text-foreground",
} satisfies Record<ActivityKind, string>;
