"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  capabilitiesByDomain,
  capabilityDescription,
  prettifyCapability,
} from "@/lib/capability-presentation";
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
        (capability) => capability !== CAPABILITIES.ADMIN_ALL && effectiveSet.has(capability),
      ),
    }))
    .filter((group) => group.capabilities.length > 0);

  return (
    <div className="@container space-y-6">
      <section className="space-y-2">
        <h3 className="type-label text-muted-foreground">{t("assignedRoles")}</h3>
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {me.roles.map((role) => (
            <li key={role.id} className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 wrap-anywhere font-medium">{role.name}</span>
              {role.id === visibleRoleId && (
                <span className="text-muted-foreground text-xs">{t("visibleRole")}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3">
        <h3 className="type-label text-muted-foreground">{t("effectiveCapabilities")}</h3>
        {hasAllCapabilities ? (
          <p className="text-sm">
            <span className="font-medium">{t("allPermissionsLabel")}</span>
            <span className="text-muted-foreground"> · {capabilityDescription("*", t)}</span>
          </p>
        ) : capabilityGroups.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noCapabilities")}</p>
        ) : (
          <dl className="grid gap-x-8 gap-y-4 @xl:grid-cols-2">
            {capabilityGroups.map((group) => (
              <div key={group.domain} className="min-w-0 space-y-0.5">
                <dt className="text-sm font-medium">{capabilityDomainLabel(group.domain, t)}</dt>
                <dd>
                  <ul className="text-muted-foreground space-y-0.5 text-sm text-pretty">
                    {group.capabilities.map((capability) => (
                      <li key={capability}>{capabilityDescription(capability, t)}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
