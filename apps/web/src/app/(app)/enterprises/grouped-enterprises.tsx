"use client";

import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import Link from "next/link";
import { useMemo } from "react";
import { IconButton } from "@/components/common/icon-button";
import { StatusBadge } from "@/components/common/status-badge";
import { useLocale } from "@/lib/i18n";
import { type Enterprise, groupEnterprises, visibilityTone } from "./shared";

/** H45: enterprises grouped by kind and priority, with manual order inside each group. */
export function GroupedEnterprises({
  enterprises,
  busy,
  onReorder,
}: {
  enterprises: Enterprise[];
  busy: boolean;
  onReorder: (ids: number[]) => void;
}) {
  const { t } = useLocale();
  const groups = useMemo(() => groupEnterprises(enterprises), [enterprises]);
  return (
    <div className="space-y-8">
      {groups.map((group) => {
        const ids = group.items.map((item) => item.id);
        const move = (index: number, by: -1 | 1) => {
          const next = [...ids];
          [next[index], next[index + by]] = [next[index + by], next[index]];
          onReorder(next);
        };
        return (
          <section key={`${group.kind}:${group.priority ?? ""}`} className="space-y-2">
            <h2 className="font-medium text-sm">
              {group.kind === "collaborator"
                ? t("enterpriseKindCollaborator")
                : t("enterpriseKindSponsor")}
              {" · "}
              {group.priority != null
                ? t("priorityGroupLabel", { priority: group.priority })
                : t("noPriority")}
            </h2>
            <ul className="divide-y border-y">
              {group.items.map((item, index) => (
                <li key={item.id} className="flex items-center gap-3 py-2">
                  <Link href={`/enterprises/${item.id}`} className="min-w-0 flex-1 truncate">
                    {item.name}
                  </Link>
                  <StatusBadge tone={visibilityTone(item.visibility)} className="capitalize">
                    {item.visibility}
                  </StatusBadge>
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    label={t("moveUp")}
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpIcon aria-hidden="true" className="size-4" />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    label={t("moveDown")}
                    disabled={busy || index === group.items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownIcon aria-hidden="true" className="size-4" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
