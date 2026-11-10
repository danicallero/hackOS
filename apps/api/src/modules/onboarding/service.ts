import { MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
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
  const { rows: rsvpRows } = await db.query<{
    accessible_count: number;
    required_count: number;
    pending_count: number;
    pending_meal_count: number;
  }>(
    `SELECT
       count(*) FILTER (WHERE NOT locked OR answered)::int AS accessible_count,
       count(*) FILTER (WHERE required)::int AS required_count,
       count(*) FILTER (WHERE NOT locked AND (NOT answered OR (required AND attending IS NULL)))::int AS pending_count,
       count(*) FILTER (WHERE is_meal AND NOT locked AND (NOT answered OR (required AND attending IS NULL)))::int AS pending_meal_count
     FROM (
       SELECT s.required, r.user_id IS NOT NULL AS answered, r.attending,
              a.category = ANY($4::text[]) AS is_meal,
              now() >= COALESCE(s.closes_at,sc.starts_at - make_interval(hours =>
                COALESCE((SELECT meal_plan_cutoff_hours FROM event_config WHERE id=1),24))) AS locked
       FROM activity_rsvp_settings s
       JOIN activities a ON a.id=s.activity_id
       JOIN schedule sc ON sc.id=a.schedule_id
       LEFT JOIN activity_rsvps r ON r.activity_id=a.id AND r.event_key=s.event_key AND r.user_id=$1
       WHERE s.event_key=$2 AND s.enabled AND sc.visibility='shown' AND sc.ends_at>now()
         AND $3::text = ANY(s.kinds)
         AND NOT ($3='participant' AND a.category = ANY($4::text[]))
     ) offers`,
    [userId, event.event_key, kind, [...MEAL_ACTIVITY_KINDS]],
  );
  const rsvp = rsvpRows[0] ?? {
    accessible_count: 0,
    required_count: 0,
    pending_count: 0,
    pending_meal_count: 0,
  };
  const config: OnboardingConfig = {
    ...event.onboarding_config,
    rsvp: {
      ...event.onboarding_config.rsvp,
      required: Boolean(event.onboarding_config.rsvp?.required || rsvp.required_count > 0),
    },
  };
  const facts: OnboardingFacts = {
    attendanceKind: kind as AttendanceKind | null,
    mentorEligible: eligible,
    openRsvps: rsvp.accessible_count > 0,
    complete: {
      profile: Boolean(user?.name && user?.surname),
      dietary: Boolean(user?.dietary_confirmed_at),
      networking: Boolean(profileRows[0]?.directory_visible),
      mentor_profile: Boolean(mentorRows[0]?.published),
      rsvp: rsvp.pending_count === 0,
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
    pendingMealRsvps: rsvp.pending_meal_count > 0,
  };
}
