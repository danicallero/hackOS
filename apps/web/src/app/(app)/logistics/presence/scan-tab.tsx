"use client";

import {
  AlertTriangleIcon,
  BadgeCheckIcon,
  CheckCircle2Icon,
  CheckIcon,
  ClockIcon,
  DoorOpenIcon,
  LogInIcon,
  LogOutIcon,
  RotateCcwIcon,
  ScanLineIcon,
  SearchIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DateTimeInput } from "@/components/common/datetime-input";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
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
import { Textarea } from "@/components/ui/textarea";
import { LOCALE_CODES, useLocale } from "@/lib/i18n";
import {
  type AccreditationLookup,
  logisticsApi,
  type PersonSearchResult,
  type PresenceLookup,
  personName,
} from "@/lib/logistics";
import { hoursSince, TIME_FORMAT_OPTIONS } from "./shared";

// ── Scan tab: unified accreditation + presence lookup ─────────────────────

export function ScanTab({
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
