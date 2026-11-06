/** Row shapes for raw SQL results (plan/07 §4 and the consolidated baseline schema). */

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
  room_entered_at: string | null;
  presentation_started_at: string | null;
  presentation_paused_at: string | null;
  presentation_paused_seconds: number;
  presentation_total_seconds: number | null;
  completed_at: string | null;
  precalled_at: string | null;
  created_at: string;
  updated_at: string;
}
