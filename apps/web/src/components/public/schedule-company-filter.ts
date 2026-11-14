import type { PublicScheduleItem } from "@/lib/logistics";

/** Distinct companies linked to `items` (H48), by name. */
export function deriveScheduleCompanies(
  items: readonly PublicScheduleItem[],
): { id: number; name: string }[] {
  const byId = new Map<number, string>();
  for (const item of items) for (const e of item.enterprises ?? []) byId.set(e.id, e.name);
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function matchesScheduleCompanyFilter(
  item: PublicScheduleItem,
  selected: ReadonlySet<string>,
): boolean {
  if (selected.size === 0) return true;
  return (item.enterprises ?? []).some((e) => selected.has(String(e.id)));
}

/** Searchable text of an item's speakers and companies. */
export function scheduleLinksText(item: PublicScheduleItem): string {
  return [
    ...(item.speakers ?? []).map((s) => s.name),
    ...(item.enterprises ?? []).map((e) => e.name),
  ].join(" ");
}
