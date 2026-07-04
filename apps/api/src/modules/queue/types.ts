/** Row shapes for raw SQL results (plan/07 §4, rooms/queue/judging section of 0001_initial.sql). */

export interface QueueEntryRow {
  id: number;
  challenge_id: number;
  repo_id: number;
  assigned_room_id: number | null;
  status: string;
  position: number | null;
  priority: number;
  call_count: number;
  called_at: string | null;
  presentation_started_at: string | null;
  completed_at: string | null;
  precalled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomRow {
  id: number;
  name: string;
  slug: string;
  location: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RoomQueueStateRow {
  room_id: number;
  is_paused: boolean;
  max_in_waiting_area: number;
  desired_minutes_per_team: number;
  started_at: string | null;
  updated_at: string;
}

export interface QueueSettingsRow {
  id: number;
  handoff_buffer_minutes: number;
  schedule_start_at: string | null;
  schedule_end_at: string | null;
  pre_call_notification_eta_minutes: number;
  requeue_prompt_default: string;
}
