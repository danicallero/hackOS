import type { UserDetail } from "@/lib/types";

export function fullName(u: Pick<UserDetail, "name" | "surname" | "email">): string {
  return [u.name, u.surname].filter(Boolean).join(" ").trim() || u.email;
}

export function initials(u: Pick<UserDetail, "name" | "surname" | "email">): string {
  const a = u.name?.trim()?.[0];
  const b = u.surname?.trim()?.[0];
  if (a || b) return `${a ?? ""}${b ?? ""}`.toUpperCase();
  return u.email.slice(0, 2).toUpperCase();
}
