import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  type AttendanceKind,
  type OnboardingConfig,
  type OnboardingFacts,
  type OnboardingState,
  resolveOnboarding,
} from "@hackos/shared/onboarding";
import { pool, type Queryable } from "../../db/pool.js";
import { createAuthorizationContext, userHasCapability } from "../../lib/capabilities.js";
import { attendanceKind } from "../identity/attendance.js";
import { offeredRsvps } from "../rsvps/service.js";

export async function readOnboarding(db: Queryable = pool, userId: number) {
  const { rows: configs } = await db.query<{
    event_key: string;
    onboarding_revision: number;
    onboarding_config: OnboardingConfig;
  }>("SELECT event_key,onboarding_revision,onboarding_config FROM event_config WHERE id=1");
  const event = configs[0] ?? {
    event_key: "default",
    onboarding_revision: 1,
    onboarding_config: {},
  };
  const kind = await attendanceKind(db, userId);
  const eligible = await userHasCapability(
    createAuthorizationContext(userId, db),
    CAPABILITIES.HELPDESK_OFFER,
  );
  const { rows: userRows } = await db.query<{
    name: string | null;
    surname: string | null;
    dietary_confirmed_at: Date | null;
    notification_onboarded_at: Date | null;
  }>("SELECT name,surname,dietary_confirmed_at,notification_onboarded_at FROM users WHERE id=$1", [
    userId,
  ]);
  const user = userRows[0];
  const { rows: profileRows } = await db.query<{ directory_visible: boolean }>(
    "SELECT directory_visible FROM user_public_profiles WHERE user_id=$1",
    [userId],
  );
  const { rows: mentorRows } = await db.query<{ published: boolean }>(
    "SELECT published FROM mentor_profiles WHERE user_id=$1 AND event_key=$2",
    [userId, event.event_key],
  );
  // H59: onboarding uses exactly the same offers as the profile RSVP editor.
  const offered = await offeredRsvps(db, userId, kind, event.event_key, "en");
  const pending = offered.filter((item) => !item.locked && !item.answered);
  const config: OnboardingConfig = event.onboarding_config;
  const facts: OnboardingFacts = {
    attendanceKind: kind as AttendanceKind | null,
    mentorEligible: eligible,
    openRsvps: pending.length > 0,
    complete: {
      profile: Boolean(user?.name && user?.surname),
      dietary: Boolean(user?.dietary_confirmed_at),
      networking: Boolean(profileRows[0]?.directory_visible),
      mentor_profile: Boolean(mentorRows[0]?.published),
      rsvp: pending.length === 0,
      notifications: Boolean(user?.notification_onboarded_at),
    },
  };
  const { rows: stateRows } = await db.query<{
    step: OnboardingState["step"];
    status: OnboardingState["status"];
    deferred_until: Date | null;
    config_revision: number;
  }>(
    "SELECT step,status,deferred_until,config_revision FROM onboarding_step_states WHERE user_id=$1 AND event_key=$2",
    [userId, event.event_key],
  );
  const states: OnboardingState[] = stateRows.map((row) => ({
    step: row.step,
    status: row.status,
    deferredUntil: row.deferred_until?.toISOString() ?? null,
    configRevision: row.config_revision,
  }));
  return {
    eventKey: event.event_key,
    revision: event.onboarding_revision,
    steps: resolveOnboarding(config, event.onboarding_revision, states, facts),
    // The organizer's localized welcome text, for the welcome step only.
    welcomeMessage: event.onboarding_config.welcome?.message ?? null,
    facts,
    pendingMealRsvps: pending.some((item) => item.isMeal),
  };
}
