import { ALL_CAPABILITIES } from "@hackos/shared/capabilities";
import type { MultiSelectOption } from "@/components/common/multi-select";
import type { Translate } from "@/lib/i18n";
import type { UserListItem } from "@/lib/types";

/**
 * Capability presentation helpers (H8). The catalogue is derived entirely from
 * `ALL_CAPABILITIES` (the single source in @hackos/shared) so the UI never
 * hardcodes a capability string of its own.
 */

/** Domain a capability belongs to — the part before ":". "*" is the admin wildcard. */
export function capabilityDomain(cap: string): string {
  return cap === "*" ? "admin" : (cap.split(":")[0] ?? cap);
}

/** Human-ish label, e.g. "users:read" → "Users · Read", "*" → "All permissions". */
export function prettifyCapability(cap: string, t: Translate): string {
  if (cap === "*") return t("allPermissionsLabel");
  const [domain, action] = cap.split(":");
  const cap1 = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  return action ? `${cap1(domain)} · ${cap1(action)}` : cap1(domain);
}

/** Options for the capabilities MultiSelect: raw string value + prettified label. */
export function capabilityOptions(t: Translate): MultiSelectOption[] {
  return ALL_CAPABILITIES.map((cap) => ({
    value: cap,
    label: cap,
    description: prettifyCapability(cap, t),
  }));
}

/** All capabilities grouped by domain, preserving catalogue order. */
export function capabilitiesByDomain(): { domain: string; capabilities: string[] }[] {
  const groups: { domain: string; capabilities: string[] }[] = [];
  for (const cap of ALL_CAPABILITIES) {
    const domain = capabilityDomain(cap);
    let group = groups.find((g) => g.domain === domain);
    if (!group) {
      group = { domain, capabilities: [] };
      groups.push(group);
    }
    group.capabilities.push(cap);
  }
  return groups;
}

/** Display name for a user directory entry, falling back to email / "User #id". */
export function userDisplayName(
  user: Pick<UserListItem, "id" | "name" | "surname" | "email">,
  t: Translate,
): string {
  const full = [user.name, user.surname].filter(Boolean).join(" ").trim();
  return full || user.email || t("userNumberFallback", { id: user.id });
}
