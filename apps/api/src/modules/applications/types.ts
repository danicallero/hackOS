import type { FormSection, TemplateField } from "./schemas.js";

/**
 * Applications domain service (H11-H15, H27, H56). Holds the state-machine
 * transitions (plan/07 §3: draft -> review -> accepted|rejected; accepted ->
 * confirmed|declined|expired), the sensitive-data privacy semantics (H12)
 * and the confirm/decline/expire mechanics shared by the three confirmation
 * routes (H15) and the expirer worker (plan/07 §5.2).
 */

export interface ApplicationRow {
  id: number;
  name: string;
  template: TemplateField[];
  sections: FormSection[];
  current_form_version: number;
  description: string | null;
  open_at: Date | null;
  close_at: Date | null;
  capacity: number | null;
  confirmation_window_hours: number;
  ask_shirt_size: boolean;
  ask_food_intolerances: boolean;
  created_at: Date;
}

export interface ResponseRow {
  id: number;
  user_id: number;
  application_id: number;
  application_form_version_id: number | string;
  status: string;
  responses: Record<string, unknown>;
  staff_notes: string | null;
  confirmation_token_id: number | null;
  confirmed_at: Date | null;
  declined_at: Date | null;
  decision_sent_at: Date | null;
  rejection_reason: string | null;
  submitted_at: Date | null;
  allow_resubmit_after_close: boolean;
  auto_accept_on_resubmit: boolean;
  can_delete_draft?: boolean;
  created_at: Date;
  updated_at: Date;
}
