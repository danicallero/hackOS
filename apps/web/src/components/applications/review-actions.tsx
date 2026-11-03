"use client";

import type { Icon } from "@phosphor-icons/react";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { dialogIconButtonClass } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/lib/i18n";

export interface ReviewAction {
  id: string;
  label: string;
  icon: Icon;
  disabled?: boolean;
  run: () => void;
}

/** H13: only authorized actions compete for space; overflow preserves touch targets. */
export function ReviewActions({
  primary,
  actions,
  trailing,
}: {
  primary?: ReactNode;
  actions: ReviewAction[];
  trailing: ReactNode;
}) {
  const { t } = useLocale();
  const row = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const primaryRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const hasPrimary = Boolean(primary);
  useLayoutEffect(() => {
    const measure = () => {
      if (!row.current || !status.current || !probe.current) return;
      const width = row.current.clientWidth;
      const buttonWidth = probe.current.getBoundingClientRect().width;
      const gap = Number.parseFloat(getComputedStyle(row.current).columnGap) || 0;
      const primaryWidth = primaryRef.current?.getBoundingClientRect().width ?? 0;
      const fixed =
        status.current.getBoundingClientRect().width + primaryWidth + (hasPrimary ? gap : 0);
      const fits = (count: number, overflow: boolean) =>
        fixed + (count + Number(overflow)) * (buttonWidth + gap) <= width;
      let count = actions.length;
      if (!fits(count, false)) {
        count = Math.max(0, actions.length - 1);
        while (count > 0 && !fits(count, true)) count -= 1;
      }
      setVisibleCount(count);
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [row.current, status.current, probe.current, primaryRef.current]) {
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [actions.length, hasPrimary]);
  const visible = actions.slice(0, visibleCount);
  const overflow = actions.slice(visibleCount);
  return (
    <div
      ref={row}
      className="relative -mx-2 flex min-w-0 shrink-0 w-[calc(100%+1rem)] items-center gap-1 sm:hidden"
    >
      <span
        ref={probe}
        aria-hidden="true"
        className={`${dialogIconButtonClass} invisible pointer-events-none absolute`}
      />
      {primary && (
        <div ref={primaryRef} className="shrink-0">
          {primary}
        </div>
      )}
      {visible.map((action) => (
        <Button
          key={action.id}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={action.label}
          disabled={action.disabled}
          onClick={action.run}
        >
          <action.icon aria-hidden="true" />
        </Button>
      ))}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("moreActions")}>
              <DotsThreeIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflow.map((action) => (
              <DropdownMenuItem key={action.id} disabled={action.disabled} onSelect={action.run}>
                <action.icon aria-hidden="true" />
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div ref={status} className="ms-auto flex shrink-0 items-center gap-1.5">
        {trailing}
      </div>
    </div>
  );
}
