"use client";

import type { Column } from "@/components/common/data-table";
import { RevealCell, VisibilityBadge } from "@/components/common/publication-status";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Translate } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import type { Enterprise } from "./shared";

export function buildEnterpriseColumns(
  t: Translate,
  onKindChange: (enterprise: Enterprise, kind: Enterprise["kind"]) => void,
): Column<Enterprise>[] {
  return [
    {
      id: "name",
      header: t("enterprises"),
      sortValue: (e) => e.name.toLowerCase(),
      cell: (e) => (
        <div className="flex items-center gap-3">
          <Avatar size="sm">
            {e.logo_url ? (
              <SponsorLogo
                logoUrl={e.logo_url}
                logoNegativeUrl={e.logo_negative_url}
                alt={e.name}
                className="size-full object-contain"
              />
            ) : (
              <AvatarFallback>{initials(e.name)}</AvatarFallback>
            )}
          </Avatar>
          <span className="font-medium">{e.name}</span>
        </div>
      ),
    },
    {
      id: "website",
      header: t("colWebsite"),
      cell: (e) =>
        e.website ? (
          <span className="text-muted-foreground text-sm">
            {e.website.replace(/^https?:\/\//, "")}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "visibility",
      header: t("colVisibility"),
      sortValue: (e) => e.visibility,
      cell: (e) => <VisibilityBadge visibility={e.visibility} />,
    },
    {
      id: "reveal",
      header: t("colReveal"),
      sortValue: (e) => e.available_from ?? "",
      cell: (e) => <RevealCell visibility={e.visibility} availableFrom={e.available_from} />,
    },
    {
      id: "kind",
      header: t("enterpriseKindLabel"),
      sortValue: (e) => e.kind,
      cell: (e) => (
        // Stops the row link so changing the group does not open the enterprise.
        // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: click shield only; the Select inside owns keyboard use.
        <span className="inline-block" onClick={(event) => event.stopPropagation()}>
          <Select
            value={e.kind}
            onValueChange={(kind) => onKindChange(e, kind as Enterprise["kind"])}
          >
            <SelectTrigger size="sm" aria-label={t("enterpriseKindLabel")} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sponsor">{t("enterpriseKindSponsor")}</SelectItem>
              <SelectItem value="collaborator">{t("enterpriseKindCollaborator")}</SelectItem>
            </SelectContent>
          </Select>
        </span>
      ),
    },
    {
      id: "priority",
      header: t("priorityLabel"),
      align: "right",
      sortValue: (e) => e.priority ?? Number.POSITIVE_INFINITY,
      cell: (e) =>
        e.priority != null ? (
          <span className="text-sm">{e.priority}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
}
