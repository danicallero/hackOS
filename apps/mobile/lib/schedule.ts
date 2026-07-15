import { apiFetch } from "./api";

export interface ScheduleItem {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  type: string | null;
  startsAt: string;
  endsAt: string;
}

export async function fetchPublicSchedule(): Promise<ScheduleItem[]> {
  const response = await apiFetch<{ items: ScheduleItem[] }>("/api/public/activities");
  return response.items;
}
