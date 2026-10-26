"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { Badge } from "@/components/ui/badge";
import { capabilitiesByDomain, prettifyCapability } from "@/lib/capability-presentation";
import { type MessageKey, type Translate, useLocale } from "@/lib/i18n";
import type { Me } from "@/lib/types";

const CAPABILITY_DOMAIN_LABELS: Record<string, MessageKey> = {
  users: "users",
  permissions: "permissions",
  invites: "capabilityAreaInvites",
  applications: "applications",
  statistics: "capabilityAreaStatistics",
  projects: "projects",
  accredit: "accreditation",
  presence: "presence",
  activity: "activities",
  logistics: "logistics",
  intolerances: "foodIntolerances",
  queue: "queueOperations",
  judge: "judges",
  judging: "judging",
  sponsors: "sponsors",
  challenges: "challenges",
  schedule: "schedule",
  announcements: "announcements",
  tv: "tvControl",
  event: "eventSettings",
  venue: "toastVenueSettings",
  wallet: "wallet",
  notifications: "toastNotificationSettings",
  audit: "auditLog",
  exports: "capabilityAreaExports",
};

function capabilityDomainLabel(domain: string, t: Translate): string {
  const key = CAPABILITY_DOMAIN_LABELS[domain];
  return key ? t(key) : prettifyCapability(domain, t);
}

/** H8: the assigned roles and the capabilities they grant, read-only. */
export function ProfileRoles({ me }: { me: Me }) {
  const { t } = useLocale();
  const visibleRoleId = me.roles.find((role) => role.isVisible)?.id;
  const hasAllCapabilities = me.capabilities.includes(CAPABILITIES.ADMIN_ALL);
  const effectiveSet = new Set<string>(me.capabilities);
  const capabilityGroups = capabilitiesByDomain()
    .map((group) => ({
      ...group,
      capabilities: group.capabilities.filter(
        (capability) =>
          capability !== CAPABILITIES.ADMIN_ALL &&
          (hasAllCapabilities || effectiveSet.has(capability)),
      ),
    }))
    .filter((group) => group.capabilities.length > 0);

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h3 className="type-label text-muted-foreground">{t("assignedRoles")}</h3>
        <ul className="divide-y divide-border/60">
          {me.roles.map((role) => (
            <li
              key={role.id}
              className="flex min-w-0 flex-wrap items-center gap-2 py-2.5 text-sm first:pt-0"
            >
              <span className="min-w-0 wrap-anywhere font-medium">{role.name}</span>
              {role.id === visibleRoleId && <Badge variant="outline">{t("visibleRole")}</Badge>}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3">
        <h3 className="type-label text-muted-foreground">{t("effectiveCapabilities")}</h3>
        {capabilityGroups.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noCapabilities")}</p>
        ) : (
          <dl className="divide-y divide-border/60">
            {capabilityGroups.map((group) => (
              <div
                key={group.domain}
                className="grid gap-2 py-3 first:pt-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4"
              >
                <dt className="text-sm font-medium">{capabilityDomainLabel(group.domain, t)}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {group.capabilities.map((capability) => (
                    <span
                      key={capability}
                      className="rounded-control border border-border/60 px-2 py-0.5 text-xs"
                    >
                      {prettifyCapability(capability, t)}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
