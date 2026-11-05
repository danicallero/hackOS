"use client";

import { PublicScheduleView } from "@/components/public/public-schedule-view";

/** Same route for everyone: signed-out visitors get the schedule without the personal area. */
export default function TimetablePage() {
  return <PublicScheduleView />;
}
