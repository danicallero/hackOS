"use client";

import {
  STATISTICS_PARTICIPANT_STATUSES,
  type StatisticsParticipantStatus,
} from "@hackos/shared/statistics";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { FunnelIcon } from "@phosphor-icons/react/dist/csr/Funnel";
import { TicketIcon } from "@phosphor-icons/react/dist/csr/Ticket";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface StatisticsFilterScope {
  key: string;
  kind: "application" | "role";
  name: string;
}

type MobileView =
  | { kind: "root" }
  | { kind: "applications" }
  | { kind: "roles" }
  | { kind: "participants"; scopeKey: string };

const DEFAULT_PARTICIPANT_STATUSES: StatisticsParticipantStatus[] = ["confirmed"];
const MENU_WIDTH = "w-72 max-w-[calc(100vw-2rem)]";

export function StatisticsScopeFilterMenu({
  scopes,
  selectedScopeKeys,
  participantStatusesByApplication,
  onScopeChange,
  onParticipantStatusesChange,
  className,
  chipsClassName,
  iconOnly = false,
}: {
  scopes: readonly StatisticsFilterScope[];
  selectedScopeKeys: readonly string[];
  participantStatusesByApplication: Readonly<
    Record<string, readonly StatisticsParticipantStatus[] | undefined>
  >;
  onScopeChange: (keys: string[]) => void;
  onParticipantStatusesChange: (scopeKey: string, statuses: StatisticsParticipantStatus[]) => void;
  className?: string;
  chipsClassName?: string;
  iconOnly?: boolean;
}) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>({ kind: "root" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const applications = scopes.filter((scope) => scope.kind === "application");
  const roles = scopes.filter((scope) => scope.kind === "role");
  const selected = new Set(selectedScopeKeys);
  const selectedApplications = applications.filter((scope) => selected.has(scope.key));
  const selectedRoles = roles.filter((scope) => selected.has(scope.key));
  const activeCount = selectedApplications.length + selectedRoles.length;
  const mobileApplication =
    mobileView.kind === "participants"
      ? applications.find((scope) => scope.key === mobileView.scopeKey)
      : undefined;

  useEffect(() => {
    if (!open || !isMobile) return;
    const selector =
      mobileView.kind === "root" ? '[role^="menuitem"]' : "[data-statistics-filter-back]";
    contentRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [open, isMobile, mobileView]);

  function currentStatuses(scopeKey: string): readonly StatisticsParticipantStatus[] {
    return participantStatusesByApplication[scopeKey] ?? DEFAULT_PARTICIPANT_STATUSES;
  }

  function setAllOfKind(kind: StatisticsFilterScope["kind"], include: boolean) {
    const kindScopes = scopes.filter((scope) => scope.kind === kind);
    const target = new Set(kindScopes.map((scope) => scope.key));
    const next = include
      ? [...selectedScopeKeys.filter((key) => !target.has(key)), ...target]
      : selectedScopeKeys.filter((key) => !target.has(key));
    onScopeChange([...new Set(next)]);
    if (kind === "application" && include) {
      for (const scope of kindScopes) {
        if (!selected.has(scope.key)) {
          onParticipantStatusesChange(scope.key, DEFAULT_PARTICIPANT_STATUSES);
        }
      }
    }
  }

  function selectApplicationStatuses(scopeKey: string, statuses: StatisticsParticipantStatus[]) {
    if (!selected.has(scopeKey)) onScopeChange([...selectedScopeKeys, scopeKey]);
    onParticipantStatusesChange(
      scopeKey,
      STATISTICS_PARTICIPANT_STATUSES.filter((status) => statuses.includes(status)),
    );
  }

  function deselectApplication(scopeKey: string) {
    onScopeChange(selectedScopeKeys.filter((key) => key !== scopeKey));
    onParticipantStatusesChange(scopeKey, DEFAULT_PARTICIPANT_STATUSES);
  }

  function clearAll() {
    onScopeChange([]);
    for (const scope of applications) {
      onParticipantStatusesChange(scope.key, DEFAULT_PARTICIPANT_STATUSES);
    }
  }

  function toggleParticipantStatus(
    scopeKey: string,
    status: StatisticsParticipantStatus,
    checked: boolean,
  ) {
    const current = selected.has(scopeKey) ? currentStatuses(scopeKey) : [];
    const next = checked
      ? current.includes(status)
        ? [...current]
        : [...current, status]
      : current.filter((value) => value !== status);
    if (next.length === 0) deselectApplication(scopeKey);
    else selectApplicationStatuses(scopeKey, next);
  }

  function statusLabel(status: StatisticsParticipantStatus) {
    if (status === "confirmed") return t("statisticsParticipantConfirmed");
    if (status === "accepted_internal") return t("statisticsAcceptedInternal");
    return t("statisticsAcceptedSent");
  }

  function applicationSummary(scope: StatisticsFilterScope) {
    if (!selected.has(scope.key)) return "";
    const statuses = currentStatuses(scope.key);
    if (statuses.length === 0) return t("statisticsParticipantAll");
    return statuses.map(statusLabel).join(", ");
  }

  function participantStatusItems(scope: StatisticsFilterScope) {
    const isSelected = selected.has(scope.key);
    const statuses = currentStatuses(scope.key);
    return (
      <>
        <DropdownMenuItem
          role="menuitemradio"
          aria-checked={isSelected && statuses.length === 0}
          onSelect={(event) => {
            event.preventDefault();
            if (!isSelected || statuses.length > 0) selectApplicationStatuses(scope.key, []);
          }}
        >
          {isSelected && statuses.length === 0 ? (
            <CheckIcon aria-hidden="true" />
          ) : (
            <span className="size-4 shrink-0" aria-hidden="true" />
          )}
          <span className="wrap-break-word">{t("statisticsParticipantAll")}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {STATISTICS_PARTICIPANT_STATUSES.map((status) => (
          <DropdownMenuCheckboxItem
            key={status}
            checked={isSelected && statuses.includes(status)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              toggleParticipantStatus(scope.key, status, Boolean(checked))
            }
          >
            <span className="wrap-break-word">{statusLabel(status)}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </>
    );
  }

  function selectedChip(scope: StatisticsFilterScope) {
    const isApplication = scope.kind === "application";
    const summary = isApplication ? applicationSummary(scope) : undefined;
    const name = summary ? `${scope.name}: ${summary}` : `${t("rolesTitle")}: ${scope.name}`;
    return (
      <Button
        key={scope.key}
        type="button"
        variant="secondary"
        size="sm"
        className="max-w-full min-w-0 font-normal"
        aria-label={t("removeItemLabel", { name })}
        onClick={() => {
          if (isApplication) deselectApplication(scope.key);
          else onScopeChange(selectedScopeKeys.filter((key) => key !== scope.key));
          triggerRef.current?.focus();
        }}
      >
        <span className="truncate">
          {isApplication ? `${scope.name}: ${summary}` : `${t("rolesTitle")}: ${scope.name}`}
        </span>
        <XIcon aria-hidden="true" className="size-3.5 shrink-0" />
      </Button>
    );
  }

  function allKindCheckbox(kind: StatisticsFilterScope["kind"]) {
    const kindScopes = kind === "application" ? applications : roles;
    const selectedCount = kindScopes.filter((scope) => selected.has(scope.key)).length;
    const checked = selectedCount === kindScopes.length && kindScopes.length > 0;
    return (
      <DropdownMenuCheckboxItem
        checked={checked}
        onSelect={(event) => event.preventDefault()}
        onCheckedChange={(include) => setAllOfKind(kind, Boolean(include))}
      >
        {t("selectAll")}
      </DropdownMenuCheckboxItem>
    );
  }

  function toggleRole(scopeKey: string, checked: boolean) {
    onScopeChange(
      checked
        ? [...new Set([...selectedScopeKeys, scopeKey])]
        : selectedScopeKeys.filter((key) => key !== scopeKey),
    );
  }

  const mobileCategoryView = isMobile && mobileView.kind !== "root";

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <DropdownMenu
        dir="rtl"
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setMobileView({ kind: "root" });
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="outline"
            type="button"
            size={iconOnly ? "icon" : "default"}
            aria-label={iconOnly ? t("filtersLabel") : undefined}
            className="relative rounded-control!"
          >
            <FunnelIcon aria-hidden="true" />
            {!iconOnly && t("filtersLabel")}
            {activeCount > 0 && (
              <span
                className={cn(
                  "bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs tabular-nums",
                  iconOnly && "absolute -top-1 -right-1",
                )}
              >
                {activeCount}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          ref={contentRef}
          align="end"
          collisionPadding={8}
          style={{ direction: "ltr" }}
          className={cn(
            MENU_WIDTH,
            "max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto",
          )}
        >
          {mobileCategoryView ? (
            <>
              <DropdownMenuItem
                data-statistics-filter-back
                onSelect={(event) => {
                  event.preventDefault();
                  setMobileView(
                    mobileView.kind === "participants"
                      ? { kind: "applications" }
                      : { kind: "root" },
                  );
                }}
              >
                <ArrowLeftIcon aria-hidden="true" />
                {t("back")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {mobileView.kind === "applications" ? (
                <>
                  <DropdownMenuLabel>{t("applications")}</DropdownMenuLabel>
                  {allKindCheckbox("application")}
                  <DropdownMenuSeparator />
                  {applications.map((scope) => (
                    <DropdownMenuItem
                      key={scope.key}
                      onSelect={(event) => {
                        event.preventDefault();
                        setMobileView({ kind: "participants", scopeKey: scope.key });
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{scope.name}</span>
                      {selected.has(scope.key) && (
                        <span className="text-muted-foreground max-w-28 truncate text-xs">
                          {applicationSummary(scope)}
                        </span>
                      )}
                      <CaretRightIcon aria-hidden="true" className="size-3.5" />
                    </DropdownMenuItem>
                  ))}
                </>
              ) : mobileView.kind === "roles" ? (
                <>
                  <DropdownMenuLabel>{t("rolesTitle")}</DropdownMenuLabel>
                  {allKindCheckbox("role")}
                  <DropdownMenuSeparator />
                  {roles.map((scope) => (
                    <DropdownMenuCheckboxItem
                      key={scope.key}
                      checked={selected.has(scope.key)}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={(checked) => toggleRole(scope.key, Boolean(checked))}
                    >
                      <span className="wrap-break-word">{scope.name}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </>
              ) : (
                mobileApplication && (
                  <>
                    <DropdownMenuLabel className="wrap-break-word">
                      {mobileApplication.name}
                    </DropdownMenuLabel>
                    {participantStatusItems(mobileApplication)}
                  </>
                )
              )}
            </>
          ) : isMobile ? (
            <>
              {applications.length > 0 && (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    setMobileView({ kind: "applications" });
                  }}
                >
                  <TicketIcon aria-hidden="true" />
                  <span className="flex-1">{t("applications")}</span>
                  <span className="text-muted-foreground text-xs">
                    {selectedApplications.length}
                  </span>
                  <CaretRightIcon aria-hidden="true" className="size-3.5" />
                </DropdownMenuItem>
              )}
              {roles.length > 0 && (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    setMobileView({ kind: "roles" });
                  }}
                >
                  <span className="flex-1">{t("rolesTitle")}</span>
                  <span className="text-muted-foreground text-xs">{selectedRoles.length}</span>
                  <CaretRightIcon aria-hidden="true" className="size-3.5" />
                </DropdownMenuItem>
              )}
              {activeCount > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={clearAll}>
                    <XIcon aria-hidden="true" />
                    {t("clearFilters")}
                  </DropdownMenuItem>
                </>
              )}
            </>
          ) : (
            <>
              {applications.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger indicatorDirection="left">
                    <TicketIcon aria-hidden="true" />
                    <span className="flex-1">{t("applications")}</span>
                    <span className="text-muted-foreground text-xs">
                      {selectedApplications.length}/{applications.length}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    collisionPadding={8}
                    style={{ direction: "ltr" }}
                    className="max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
                  >
                    <DropdownMenuLabel>{t("applications")}</DropdownMenuLabel>
                    {allKindCheckbox("application")}
                    <DropdownMenuSeparator />
                    {applications.map((scope) => (
                      <DropdownMenuSub key={scope.key}>
                        <DropdownMenuSubTrigger indicatorDirection="left">
                          {selected.has(scope.key) && (
                            <CheckIcon aria-hidden="true" className="size-4 text-primary" />
                          )}
                          <span className="min-w-0 flex-1 truncate">{scope.name}</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent
                          collisionPadding={8}
                          style={{ direction: "ltr" }}
                          className={cn(
                            MENU_WIDTH,
                            "max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto",
                          )}
                        >
                          <DropdownMenuLabel className="wrap-break-word">
                            {scope.name}
                          </DropdownMenuLabel>
                          {participantStatusItems(scope)}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {roles.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger indicatorDirection="left">
                    <span className="flex-1">{t("rolesTitle")}</span>
                    <span className="text-muted-foreground text-xs">
                      {selectedRoles.length}/{roles.length}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    collisionPadding={8}
                    style={{ direction: "ltr" }}
                    className={cn(
                      MENU_WIDTH,
                      "max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto",
                    )}
                  >
                    <DropdownMenuLabel>{t("rolesTitle")}</DropdownMenuLabel>
                    {allKindCheckbox("role")}
                    <DropdownMenuSeparator />
                    {roles.map((scope) => (
                      <DropdownMenuCheckboxItem
                        key={scope.key}
                        checked={selected.has(scope.key)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(checked) => toggleRole(scope.key, Boolean(checked))}
                      >
                        <span className="wrap-break-word">{scope.name}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {activeCount > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={clearAll}>
                    <XIcon aria-hidden="true" />
                    {t("clearFilters")}
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {activeCount > 0 && (
        <div className={cn("contents", chipsClassName)}>
          {selectedApplications.map(selectedChip)}
          {selectedRoles.map(selectedChip)}
        </div>
      )}
    </div>
  );
}
