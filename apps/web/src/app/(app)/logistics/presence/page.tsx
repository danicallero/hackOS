"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  AlertTriangleIcon,
  BadgeCheckIcon,
  CheckCircle2Icon,
  CheckIcon,
  ClockIcon,
  DoorOpenIcon,
  DownloadIcon,
  LogInIcon,
  LogOutIcon,
  RotateCcwIcon,
  ScanLineIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { ContextualError } from "@/components/common/contextual-error";
import { type Column, DataTable } from "@/components/common/data-table";
import { DateTimeInput } from "@/components/common/datetime-input";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { TabBar } from "@/components/common/tab-bar";
import { PersonCardView } from "@/components/logistics/person-card";
import { PersonSearchResults } from "@/components/logistics/person-search-results";
import { QrScanButton } from "@/components/logistics/qr-scanner";
import { errorMessage, Field, InlineError } from "@/components/logistics/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useLiveQuery } from "@/hooks/use-event-source";
import { API_URL } from "@/lib/env";
import { LOCALE_CODES, type Translate, useLocale } from "@/lib/i18n";
import {
  type AccreditationLookup,
  type AccreditationRoleCount,
  logisticsApi,
  type OpenPresenceSession,
  type PersonDirectoryEntry,
  type PersonSearchResult,
  type PresenceEstimate,
  type PresenceHours,
  type PresenceLookup,
  personName,
} from "@/lib/logistics";
import { useCan } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";

const PRESENCE_TABS = ["scan", "people", "sessions", "hours"] as const;
type PresenceTab = (typeof PRESENCE_TABS)[number];

const TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

function hoursSince(iso: string, t: Translate): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? t("presenceLessThanHourAgo") : t("presenceHoursAgo", { hours: Math.round(h) });
}

function queryLoadError(
  error: unknown,
  fallback: string,
  onRetry: () => void,
): { message: string; onRetry: () => void } | undefined {
  return error ? { message: errorMessage(error, fallback), onRetry } : undefined;
}

const PRESENCE_EVENTS = [EVENTS.LOGISTICS_PRESENCE_SCAN, EVENTS.LOGISTICS_ACTIVITY_SCAN];

export default function PresencePage() {
  const { language, t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canAccredit = useCan(CAPABILITIES.ACCREDIT_SCAN);
  const canPresence = useCan(CAPABILITIES.PRESENCE_SCAN);
  const { tab, setTab } = useUrlTab<PresenceTab>({
    values: PRESENCE_TABS,
    defaultValue: "scan",
  });

  const [sessionCount, setSessionCount] = useState(0);
  const [roleCounts, setRoleCounts] = useState<AccreditationRoleCount[]>([]);
  const loadAccreditationCounts = useCallback(() => {
    void logisticsApi.accreditationStats().then((result) => setRoleCounts(result.byRole));
  }, []);
  useEffect(() => {
    if (canAccredit) loadAccreditationCounts();
  }, [canAccredit, loadAccreditationCounts]);

  const estimate = useLiveQuery<PresenceEstimate>(
    logisticsApi.presenceEstimate,
    "/api/logistics/stream",
    PRESENCE_EVENTS,
    { enabled: canPresence, debounceMs: 400 },
  );
  const hours = useLiveQuery<PresenceHours[]>(
    logisticsApi.presenceHours,
    "/api/logistics/stream",
    PRESENCE_EVENTS,
    { enabled: canPresence, debounceMs: 400 },
  );
  const openSessions = useLiveQuery<OpenPresenceSession[]>(
    async () => (await logisticsApi.presenceOpenSessions()).items,
    "/api/logistics/stream",
    PRESENCE_EVENTS,
    { enabled: canPresence, debounceMs: 400 },
  );

  // H24/H27: each read model keeps its own failure and retry path so one
  // outage cannot make another operational dataset look empty or unknown.
  const estimateError = queryLoadError(
    estimate.error,
    t("attendanceDataUnavailable"),
    estimate.refetch,
  );
  const hoursError = queryLoadError(hours.error, t("couldNotLoadStatistics"), hours.refetch);
  const openSessionsError = queryLoadError(
    openSessions.error,
    t("attendanceDataUnavailable"),
    openSessions.refetch,
  );

  const openPersonFromDirectory = useCallback(
    (userId: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", "scan");
      params.set("userId", String(userId));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  if (!canAccredit && !canPresence) {
    return <AccessDenied ask={t("presenceDeniedDesc")} />;
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader title={t("accreditationAndPresence")} />
      <Tabs value={tab} onValueChange={(value) => setTab(value)}>
        <TabBar aria-label={t("presenceSections")} className="w-full justify-start">
          <TabsTrigger value="scan">{t("presenceScanTab")}</TabsTrigger>
          <TabsTrigger value="people">{t("peopleTab")}</TabsTrigger>
          {canPresence && <TabsTrigger value="sessions">{t("presenceSessionsTab")}</TabsTrigger>}
          {canPresence && <TabsTrigger value="hours">{t("presenceHoursTab")}</TabsTrigger>}
        </TabBar>
      </Tabs>

      {tab === "scan" && canAccredit && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <StatCard
            label={t("checkedInSession")}
            value={sessionCount}
            icon={BadgeCheckIcon}
            hint={t("onThisDevice")}
          />
          {roleCounts.map((item) => (
            <StatCard
              key={item.role ?? "unassigned"}
              label={item.role ?? t("roleUnassigned")}
              value={item.count}
              icon={BadgeCheckIcon}
              hint={t("accredited")}
            />
          ))}
        </div>
      )}

      {tab === "sessions" && canPresence && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label={t("presentNow")}
            value={estimate.data?.presentCount ?? "—"}
            icon={UsersIcon}
            hint={estimate.connected ? t("liveEstimate") : t("reconnectsAutomatically")}
            footer={estimateError && <ContextualError {...estimateError} />}
          />
          <StatCard
            label={t("openSessions")}
            value={openSessions.data?.length ?? "—"}
            icon={DoorOpenIcon}
            hint={t("enteredNotExited")}
            footer={openSessionsError && <ContextualError {...openSessionsError} />}
          />
          <StatCard
            label={t("staleSessions")}
            value={openSessions.data?.filter((s) => s.stale).length ?? "—"}
            icon={AlertTriangleIcon}
            hint={t("staleSessionsHint")}
            footer={openSessionsError && <ContextualError {...openSessionsError} />}
          />
        </div>
      )}

      {tab === "scan" && (
        <ScanPanel
          canAccredit={canAccredit}
          canPresence={canPresence}
          onAccredited={() => {
            setSessionCount((n) => n + 1);
            loadAccreditationCounts();
          }}
          onPresenceScanned={() => {
            estimate.refetch();
            hours.refetch();
            openSessions.refetch();
          }}
        />
      )}

      {tab === "people" && <PeoplePanel onOpenPerson={openPersonFromDirectory} />}

      {tab === "hours" && canPresence && (
        <HoursPanel hours={hours.data ?? []} loading={hours.loading} hoursError={hoursError} />
      )}

      {tab === "sessions" && canPresence && (
        <SectionCard
          title={t("openSessions")}
          description={t("openSessionsDesc")}
          icon={AlertTriangleIcon}
          className="xl:col-span-2"
        >
          <DataTable
            columns={getOpenSessionColumns(
              t,
              new Intl.DateTimeFormat(LOCALE_CODES[language], TIME_FORMAT_OPTIONS),
            )}
            data={openSessions.data ?? []}
            getRowId={(row) =>
              row.userId != null ? `user:${row.userId}` : `pending:${row.sessionId}`
            }
            getRowLabel={(row) =>
              `${row.name ?? ""} ${row.surname ?? ""}`.trim() ||
              (row.userId != null ? String(row.userId) : t("reviewSession"))
            }
            loading={openSessions.loading}
            searchable={(row) => `${row.userId ?? ""} ${row.name ?? ""} ${row.surname ?? ""}`}
            searchPlaceholder={t("filterUsers")}
            pageSize={10}
            error={openSessionsError}
            empty={{
              icon: DoorOpenIcon,
              title: t("noOpenSessions"),
              description: t("noOpenSessionsDesc"),
            }}
          />
        </SectionCard>
      )}
    </div>
  );
}

// ── Scan tab: unified accreditation + presence lookup ─────────────────────

function ScanPanel({
  canAccredit,
  canPresence,
  onAccredited,
  onPresenceScanned,
}: {
  canAccredit: boolean;
  canPresence: boolean;
  onAccredited: () => void;
  onPresenceScanned: () => void;
}) {
  const { language, t } = useLocale();
  const timeFmt = new Intl.DateTimeFormat(LOCALE_CODES[language], TIME_FORMAT_OPTIONS);
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonSearchResult[] | null>(null);
  const [accCard, setAccCard] = useState<AccreditationLookup | null>(null);
  const [presCard, setPresCard] = useState<PresenceLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [assignBadgeId, setAssignBadgeId] = useState("");
  const [method, setMethod] = useState<"qr" | "manual" | "nfc">("qr");
  const [newBadgeId, setNewBadgeId] = useState("");
  const [reason, setReason] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualKind, setManualKind] = useState<"in" | "out">("in");
  const [manualScannedAt, setManualScannedAt] = useState("");
  const [recentScan, setRecentScan] = useState<{
    kind: "in" | "out";
    person: string;
    at: string;
  } | null>(null);

  const reset = () => {
    setQuery("");
    setResults(null);
    setAccCard(null);
    setPresCard(null);
    setAssignBadgeId("");
    setNewBadgeId("");
    setReason("");
    setManualOpen(false);
    setManualScannedAt("");
  };

  const loadPresenceByBadge = useCallback(async (badgeId: string) => {
    try {
      const result = await logisticsApi.presenceLookup(badgeId);
      setPresCard(result);
      setManualKind(result.pendingExit || result.openSince ? "out" : "in");
    } catch {
      setPresCard(null);
    }
  }, []);

  const openCard = useCallback(
    async (userId: number) => {
      if (!canAccredit) return;
      setBusy(true);
      setError("");
      try {
        const result = await logisticsApi.lookupUser(userId);
        setAccCard(result);
        setResults(null);
        setAssignBadgeId("");
        setNewBadgeId("");
        setReason("");
        if (canPresence && result.currentBadge) await loadPresenceByBadge(result.currentBadge);
        else setPresCard(null);
      } catch (err) {
        setAccCard(null);
        setError(errorMessage(err, t("userLookupFailed")));
      } finally {
        setBusy(false);
      }
    },
    [canAccredit, canPresence, loadPresenceByBadge, t],
  );

  // Sync URL query param (userId) to card state — the people tab and deep
  // links from the user profile both open a person this way (H22).
  useEffect(() => {
    const raw = searchParams.get("userId");
    if (!raw) return;
    const id = Number(raw);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Number.isFinite(id)) void openCard(id);
  }, [searchParams, openCard]);

  const doSearch = async (override?: string) => {
    const q = (override ?? query).trim();
    if (!q) return;
    setBusy(true);
    setError("");
    try {
      // A presence-only operator (no accreditation capability) never had a
      // person-search endpoint of their own — the box is a badge lookup,
      // exactly like the old standalone presence station.
      if (!canAccredit && canPresence) {
        const result = await logisticsApi.presenceLookup(q);
        setPresCard(result);
        setAccCard(null);
        setResults(null);
        setManualKind(result.pendingExit || result.openSince ? "out" : "in");
        return;
      }
      const { results: found } = await logisticsApi.searchPeople(q, [
        "email",
        "badgeId",
        "dni",
        "confirmed",
      ]);
      // A scanned QR (ticket or badge) resolves to exactly one person — open
      // their card directly so the desk flow stays a single gesture (H22).
      if (found.length === 1) {
        await openCard(found[0].userId);
      } else {
        setResults(found);
        setAccCard(null);
        setPresCard(null);
      }
    } catch (err) {
      setResults(null);
      setError(errorMessage(err, t("userSearchFailed")));
    } finally {
      setBusy(false);
    }
  };

  const doAssign = async () => {
    if (!accCard) return;
    setBusy(true);
    setError("");
    try {
      const result = await logisticsApi.checkInUser({
        userId: accCard.userId,
        badgeId: assignBadgeId.trim(),
        method,
      });
      toast.success(t("badgeAssigned", { badgeId: result.badgeId, name: personName(result) }));
      onAccredited();
      setAccCard({ ...accCard, alreadyAccredited: true, currentBadge: result.badgeId });
      setAssignBadgeId("");
      if (canPresence) await loadPresenceByBadge(result.badgeId);
    } catch (err) {
      setError(errorMessage(err, t("checkInFailed")));
    } finally {
      setBusy(false);
    }
  };

  const doRotate = async () => {
    if (!accCard) return;
    setBusy(true);
    setError("");
    try {
      const result = await logisticsApi.rotate({
        userId: accCard.userId,
        newBadgeId: newBadgeId.trim(),
        reason: reason.trim(),
      });
      toast.success(t("badgeRotatedTo", { badge: result.newBadge }));
      setAccCard({ ...accCard, alreadyAccredited: true, currentBadge: result.newBadge });
      setNewBadgeId("");
      setReason("");
      if (canPresence) await loadPresenceByBadge(result.newBadge);
    } catch (err) {
      setError(errorMessage(err, t("badgeRotationFailed")));
    } finally {
      setBusy(false);
    }
  };

  const doPresenceScan = async (kind: "in" | "out") => {
    if (!presCard) return;
    setBusy(true);
    setError("");
    try {
      const result = await logisticsApi.presenceScan({ badgeId: presCard.badgeId, kind });
      setRecentScan({ kind, person: personName(presCard), at: result.scannedAt });
      toast.success(kind === "in" ? t("entryRecorded") : t("exitRecorded"));
      reset();
      onPresenceScanned();
    } catch (err) {
      setError(errorMessage(err, t("presenceScanFailed")));
    } finally {
      setBusy(false);
    }
  };

  const doManualSave = async () => {
    if (!presCard || !manualScannedAt) return;
    const kind = presCard.pendingExit ? "out" : manualKind;
    setBusy(true);
    setError("");
    try {
      const result = await logisticsApi.presenceScan({
        badgeId: presCard.badgeId,
        kind,
        scannedAt: new Date(manualScannedAt).toISOString(),
      });
      setRecentScan({ kind, person: personName(presCard), at: result.scannedAt });
      toast.success(t("manualRecordAdded"));
      reset();
      onPresenceScanned();
    } catch (err) {
      setError(errorMessage(err, t("couldNotSaveManualRecord")));
    } finally {
      setBusy(false);
    }
  };

  const card = accCard ?? presCard;

  return (
    <div className="space-y-4">
      <SectionCard
        title={t("personSearchTitle")}
        description={t("personSearchDesc")}
        icon={SearchIcon}
        bodyClassName="space-y-4"
      >
        <form
          className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void doSearch();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="person-search">{t("personSearchTitle")}</Label>
            <Input
              id="person-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("personSearchPlaceholder")}
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" className="w-full md:w-auto" disabled={busy || !query.trim()}>
              {busy ? <Spinner /> : <ScanLineIcon className="size-4" />}
              {t("search")}
            </Button>
          </div>
          <div className="flex items-end">
            <QrScanButton
              onDecode={(value) => {
                setQuery(value);
                void doSearch(value);
              }}
            />
          </div>
        </form>

        {error && <InlineError message={error} />}

        {results && (
          <PersonSearchResults results={results} onSelect={(p) => void openCard(p.userId)} />
        )}
      </SectionCard>

      {recentScan && (
        <div
          className="border-success/40 bg-success/10 text-success-foreground flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2Icon className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium">
              {recentScan.kind === "in" ? t("entryRecorded") : t("exitRecorded")}
            </p>
            <p className="text-muted-foreground truncate">
              {t("lastPresenceScan", {
                person: recentScan.person,
                time: timeFmt.format(new Date(recentScan.at)),
              })}
            </p>
          </div>
        </div>
      )}

      {card && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <SectionCard title={personName(card)} bodyClassName="space-y-4">
            <PersonCardView card={card} />
            {presCard?.openSince && (
              <div className="border-warning/40 bg-warning/10 text-warning-foreground flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <AlertTriangleIcon className="size-4 shrink-0" />
                {t("alreadyOpenSession", {
                  time: timeFmt.format(new Date(presCard.openSince)),
                  hours: hoursSince(presCard.openSince, t),
                })}
              </div>
            )}
          </SectionCard>

          <div className="space-y-4">
            {accCard &&
              (accCard.alreadyAccredited ? (
                <SectionCard
                  title={t("rotateBadge")}
                  description={t("changeBadgeDesc")}
                  icon={RotateCcwIcon}
                  bodyClassName="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="current-badge">{t("currentBadgeLabel")}</Label>
                    <Input
                      id="current-badge"
                      value={accCard.currentBadge ?? ""}
                      readOnly
                      disabled
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-badge">{t("newBadgeLabel")}</Label>
                    <Input
                      id="new-badge"
                      value={newBadgeId}
                      onChange={(e) => setNewBadgeId(e.target.value)}
                      placeholder={t("badgeIdPlaceholder")}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rotate-reason">{t("reasonLabel")}</Label>
                    <Textarea
                      id="rotate-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t("reasonPlaceholder")}
                    />
                  </div>
                  <Button
                    onClick={doRotate}
                    disabled={busy || !newBadgeId.trim() || !reason.trim()}
                  >
                    <RotateCcwIcon className="size-4" />
                    {t("rotateBadge")}
                  </Button>
                </SectionCard>
              ) : (
                <SectionCard
                  title={t("assignBadgeAction")}
                  description={t("ticketCheckInDesc")}
                  icon={BadgeCheckIcon}
                  bodyClassName="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="badge-id">{t("badgeIdLabel")}</Label>
                    <Input
                      id="badge-id"
                      value={assignBadgeId}
                      onChange={(e) => setAssignBadgeId(e.target.value)}
                      placeholder={t("badgeIdPlaceholder")}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accreditation-method">{t("methodLabel")}</Label>
                    <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                      <SelectTrigger id="accreditation-method" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="qr">{t("scanMethodQr")}</SelectItem>
                        <SelectItem value="manual">{t("manual")}</SelectItem>
                        <SelectItem value="nfc">{t("scanMethodNfc")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={doAssign} disabled={busy || !assignBadgeId.trim()}>
                    <CheckIcon className="size-4" />
                    {t("checkIn")}
                  </Button>
                </SectionCard>
              ))}

            {canPresence && accCard && !accCard.currentBadge && (
              <SectionCard title={t("doorScan")} icon={DoorOpenIcon}>
                <p className="text-muted-foreground text-sm">{t("presenceNeedsBadge")}</p>
              </SectionCard>
            )}

            {presCard && (
              <SectionCard
                title={t("doorScan")}
                description={t("doorScanDesc")}
                icon={DoorOpenIcon}
                bodyClassName="space-y-4"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button
                    variant={presCard.openSince ? "outline" : "default"}
                    onClick={() => doPresenceScan("in")}
                    disabled={busy || !!presCard.openSince || presCard.pendingExit === true}
                  >
                    <LogInIcon className="size-4" />
                    {t("registerEntry")}
                  </Button>
                  <Button
                    variant={presCard.openSince ? "default" : "outline"}
                    onClick={() => doPresenceScan("out")}
                    disabled={busy || !presCard.openSince}
                  >
                    <LogOutIcon className="size-4" />
                    {t("registerExit")}
                  </Button>
                </div>

                <div className="border-t pt-4">
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => setManualOpen((v) => !v)}
                  >
                    <ClockIcon className="size-4" />
                    {manualOpen ? t("cancelManualRecord") : t("addManualRecord")}
                  </Button>
                </div>

                {manualOpen && (
                  <div className="bg-muted/40 space-y-3 rounded-lg border p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field id="presence-manual-direction" label={t("directionLabel")}>
                        <Select
                          value={manualKind}
                          onValueChange={(v) => setManualKind(v as "in" | "out")}
                        >
                          <SelectTrigger id="presence-manual-direction" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="in" disabled={presCard.pendingExit === true}>
                              {t("entryOption")}
                            </SelectItem>
                            <SelectItem value="out">{t("exitOption")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field id="presence-manual-time" label={t("timeLabel")}>
                        <DateTimeInput
                          id="presence-manual-time"
                          value={manualScannedAt}
                          onChange={setManualScannedAt}
                        />
                      </Field>
                    </div>
                    <Button
                      variant="outline"
                      onClick={doManualSave}
                      disabled={
                        busy ||
                        !manualScannedAt ||
                        (presCard.pendingExit === true && !presCard.openSince)
                      }
                    >
                      {t("saveManualRecord")}
                    </Button>
                  </div>
                )}
              </SectionCard>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── People tab: full roster finder, mirrors the mobile scanner directory ──

function PeoplePanel({ onOpenPerson }: { onOpenPerson: (userId: number) => void }) {
  const { t } = useLocale();
  const [people, setPeople] = useState<PersonDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items } = await logisticsApi.listPeople();
      setPeople(items);
    } catch (err) {
      setError(errorMessage(err, t("couldNotLoadPeople")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<PersonDirectoryEntry>[] = [
    {
      id: "user",
      header: t("columnUser"),
      sortValue: (row) => `${row.surname ?? ""} ${row.name ?? ""}`.trim().toLowerCase(),
      cell: (row) => {
        const name = [row.name, row.surname].filter(Boolean).join(" ").trim();
        return name ? (
          <span>{name}</span>
        ) : (
          <span className="text-muted-foreground font-mono text-sm">#{row.userId}</span>
        );
      },
    },
    {
      id: "email",
      header: t("email"),
      cell: (row) => row.email ?? "—",
      sortValue: (row) => row.email ?? "",
    },
    {
      id: "badge",
      header: t("badge"),
      cell: (row) => row.badgeId ?? t("noBadge"),
      sortValue: (row) => row.badgeId ?? "",
    },
    {
      id: "status",
      header: t("statusColumn"),
      cell: (row) => (
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={row.confirmed ? "success" : "warning"} dot={false}>
            {row.confirmed ? t("confirmed") : t("notConfirmed")}
          </StatusBadge>
          <StatusBadge tone={row.present ? "success" : "neutral"} dot={false}>
            {row.present ? t("currentlyInside") : t("currentlyOutside")}
          </StatusBadge>
        </div>
      ),
    },
  ];

  return (
    <SectionCard title={t("peopleTab")} icon={UsersIcon}>
      <DataTable
        columns={columns}
        data={people}
        getRowId={(row) => String(row.userId)}
        onRowClick={(row) => onOpenPerson(row.userId)}
        getRowLabel={(row) =>
          [row.name, row.surname].filter(Boolean).join(" ") || String(row.userId)
        }
        loading={loading}
        searchable={(row) =>
          [row.name, row.surname, row.email, row.badgeId, row.dni].filter(Boolean).join(" ")
        }
        searchPlaceholder={t("peopleSearchPlaceholder")}
        pageSize={20}
        error={error ? { message: error, onRetry: load } : undefined}
        empty={{ icon: UsersIcon, title: t("noPeopleYet") }}
      />
    </SectionCard>
  );
}

// ── Hours tab: min-hours filter + CSV exports (H54) ────────────────────────

function HoursPanel({
  hours,
  loading,
  hoursError,
}: {
  hours: PresenceHours[];
  loading: boolean;
  hoursError?: { message: string; onRetry: () => void };
}) {
  const { t } = useLocale();
  const canExport = useCan(CAPABILITIES.LOGISTICS_STATS);
  const [minHours, setMinHours] = useState("");

  const filtered = useMemo(() => {
    const min = Number(minHours);
    if (!minHours.trim() || Number.isNaN(min)) return hours;
    return hours.filter((row) => row.hours >= min);
  }, [hours, minHours]);

  const exportHref = (format: "reduced" | "full") => {
    const params = new URLSearchParams({ format });
    if (filtered.length) params.set("userIds", filtered.map((row) => row.userId).join(","));
    return `${API_URL}/api/presence/hours/export.csv?${params.toString()}`;
  };

  const columns: Column<PresenceHours>[] = [
    {
      id: "user",
      header: t("columnUser"),
      sortValue: (row) => `${row.surname ?? ""} ${row.name ?? ""}`.trim().toLowerCase(),
      cell: (row) => {
        const name = [row.name, row.surname].filter(Boolean).join(" ").trim();
        return name ? (
          <span>{name}</span>
        ) : (
          <span className="text-muted-foreground font-mono text-sm">#{row.userId}</span>
        );
      },
    },
    {
      id: "hours",
      header: t("columnHours"),
      align: "right",
      sortValue: (row) => row.hours,
      cell: (row) => <span className="font-mono tabular-nums">{row.hours.toFixed(2)}</span>,
    },
  ];

  return (
    <SectionCard
      title={t("attendanceHours")}
      description={t("attendanceHoursDesc")}
      icon={UsersIcon}
      action={
        <div className="flex flex-wrap items-end gap-2">
          <Field id="min-hours" label={t("minHoursLabel")}>
            <Input
              id="min-hours"
              type="number"
              min={0}
              step="0.5"
              className="w-24"
              value={minHours}
              onChange={(e) => setMinHours(e.target.value)}
              placeholder="0"
            />
          </Field>
          {canExport && (
            <>
              <Button asChild variant="outline">
                <a href={exportHref("reduced")}>
                  <DownloadIcon className="size-4" aria-hidden="true" />
                  {t("exportHoursReduced")}
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={exportHref("full")}>
                  <DownloadIcon className="size-4" aria-hidden="true" />
                  {t("exportHoursDetailed")}
                </a>
              </Button>
            </>
          )}
        </div>
      }
    >
      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(row) => String(row.userId)}
        getRowHref={(row) => `/users/${row.userId}?tab=presence`}
        getRowLabel={(row) => `${row.name ?? ""} ${row.surname ?? ""}`.trim() || String(row.userId)}
        loading={loading}
        searchable={(row) => `${row.userId} ${row.name ?? ""} ${row.surname ?? ""} ${row.hours}`}
        searchPlaceholder={t("filterUsers")}
        pageSize={10}
        error={hoursError}
        empty={{
          icon: UsersIcon,
          title: t("noPresenceYet"),
          description: t("noPresenceYetDesc"),
        }}
      />
    </SectionCard>
  );
}

function getOpenSessionColumns(
  t: Translate,
  timeFmt: Intl.DateTimeFormat,
): Column<OpenPresenceSession>[] {
  return [
    {
      id: "user",
      header: t("columnUser"),
      sortValue: (row) => `${row.surname ?? ""} ${row.name ?? ""}`.trim().toLowerCase(),
      cell: (row) => {
        const name = [row.name, row.surname].filter(Boolean).join(" ").trim();
        return name ? (
          <span>{name}</span>
        ) : (
          <span className="text-muted-foreground font-mono text-sm">
            {row.userId != null ? `#${row.userId}` : "—"}
          </span>
        );
      },
    },
    {
      id: "since",
      header: t("columnEntered"),
      sortValue: (row) => row.since,
      cell: (row) => <span className="text-sm">{timeFmt.format(new Date(row.since))}</span>,
    },
    {
      id: "lastSignal",
      header: t("columnLastSignal"),
      sortValue: (row) => row.lastSignal,
      cell: (row) => (
        <span className="text-sm">
          {timeFmt.format(new Date(row.lastSignal))} ({hoursSince(row.lastSignal, t)})
        </span>
      ),
    },
    {
      id: "stale",
      header: t("statusColumn"),
      cell: (row) => (
        <StatusBadge tone={row.stale ? "warning" : "neutral"} dot={false}>
          {row.stale ? t("staleCheck") : t("fresh")}
        </StatusBadge>
      ),
    },
    {
      id: "review",
      header: t("columnActions"),
      align: "right",
      cell: (row) =>
        row.userId == null ? null : (
          <Button asChild size="sm" variant="outline">
            <Link href={`/users/${row.userId}?tab=presence`}>{t("reviewSession")}</Link>
          </Button>
        ),
    },
  ];
}
