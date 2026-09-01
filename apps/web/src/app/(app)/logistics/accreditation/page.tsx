"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { BadgeCheckIcon, CheckIcon, RotateCcwIcon, ScanLineIcon, SearchIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { PersonCardView } from "@/components/logistics/person-card";
import { PersonSearchResults } from "@/components/logistics/person-search-results";
import { errorMessage, InlineError } from "@/components/logistics/ui";
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
import { useLocale } from "@/lib/i18n";
import {
  type AccreditationLookup,
  type AccreditationRoleCount,
  logisticsApi,
  type PersonSearchResult,
  personName,
} from "@/lib/logistics";
import { useCan } from "@/lib/session";

export default function AccreditationPage() {
  const { t } = useLocale();
  const canAccredit = useCan(CAPABILITIES.ACCREDIT_SCAN);
  const [sessionCount, setSessionCount] = useState(0);
  const [roleCounts, setRoleCounts] = useState<AccreditationRoleCount[]>([]);

  const loadCounts = useCallback(() => {
    void logisticsApi.accreditationStats().then((result) => setRoleCounts(result.byRole));
  }, []);

  useEffect(() => {
    if (canAccredit) loadCounts();
  }, [canAccredit, loadCounts]);

  if (!canAccredit) {
    return <AccessDenied ask={t("accreditationDeniedDesc")} />;
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader title={t("accreditation")} />
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
      <AccreditationPanel
        onAccredited={() => {
          setSessionCount((n) => n + 1);
          loadCounts();
        }}
      />
    </div>
  );
}

function AccreditationPanel({ onAccredited }: { onAccredited: () => void }) {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonSearchResult[] | null>(null);
  const [card, setCard] = useState<AccreditationLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [badgeId, setBadgeId] = useState("");
  const [method, setMethod] = useState<"qr" | "manual" | "nfc">("qr");
  const [newBadgeId, setNewBadgeId] = useState("");
  const [reason, setReason] = useState("");

  const openCard = useCallback(
    async (userId: number) => {
      setBusy(true);
      setError("");
      try {
        const result = await logisticsApi.lookupUser(userId);
        setCard(result);
        setResults(null);
        setBadgeId("");
        setNewBadgeId("");
        setReason("");
      } catch (err) {
        setCard(null);
        setError(errorMessage(err, t("userLookupFailed")));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  // Sync URL query param (userId) to card state by fetching from the API.
  useEffect(() => {
    const raw = searchParams.get("userId");
    if (!raw) return;
    const id = Number(raw);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Number.isFinite(id)) void openCard(id);
  }, [searchParams, openCard]);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError("");
    try {
      const { results: found } = await logisticsApi.searchPeople(q, [
        "email",
        "badgeId",
        "confirmed",
      ]);
      // A scanned QR (ticket or badge) resolves to exactly one person — open
      // their card directly so the desk flow stays a single gesture (H22).
      if (found.length === 1) {
        await openCard(found[0].userId);
      } else {
        setResults(found);
        setCard(null);
      }
    } catch (err) {
      setResults(null);
      setError(errorMessage(err, t("userSearchFailed")));
    } finally {
      setBusy(false);
    }
  };

  const doAssign = async () => {
    if (!card) return;
    setBusy(true);
    setError("");
    try {
      const result = await logisticsApi.checkInUser({
        userId: card.userId,
        badgeId: badgeId.trim(),
        method,
      });
      toast.success(t("badgeAssigned", { badgeId: result.badgeId, name: personName(result) }));
      onAccredited();
      setCard({ ...card, alreadyAccredited: true, currentBadge: result.badgeId });
      setBadgeId("");
    } catch (err) {
      setError(errorMessage(err, t("checkInFailed")));
    } finally {
      setBusy(false);
    }
  };

  const doRotate = async () => {
    if (!card) return;
    setBusy(true);
    setError("");
    try {
      const result = await logisticsApi.rotate({
        userId: card.userId,
        newBadgeId: newBadgeId.trim(),
        reason: reason.trim(),
      });
      toast.success(t("badgeRotatedTo", { badge: result.newBadge }));
      setCard({ ...card, alreadyAccredited: true, currentBadge: result.newBadge });
      setNewBadgeId("");
      setReason("");
    } catch (err) {
      setError(errorMessage(err, t("badgeRotationFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard
        title={t("personSearchTitle")}
        description={t("personSearchDesc")}
        icon={SearchIcon}
        bodyClassName="space-y-4"
      >
        <form
          className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]"
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
            <Button type="submit" className="w-full" disabled={busy || !query.trim()}>
              {busy ? <Spinner /> : <ScanLineIcon className="size-4" />}
              {t("search")}
            </Button>
          </div>
        </form>

        {error && <InlineError message={error} />}

        {results && (
          <PersonSearchResults results={results} onSelect={(p) => void openCard(p.userId)} />
        )}
      </SectionCard>

      {card && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <SectionCard title={personName(card)} bodyClassName="space-y-4">
            <PersonCardView card={card} />
          </SectionCard>

          {card.alreadyAccredited ? (
            <SectionCard
              title={t("rotateBadge")}
              description={t("changeBadgeDesc")}
              icon={RotateCcwIcon}
              bodyClassName="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="current-badge">{t("currentBadgeLabel")}</Label>
                <Input id="current-badge" value={card.currentBadge ?? ""} readOnly disabled />
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
              <Button onClick={doRotate} disabled={busy || !newBadgeId.trim() || !reason.trim()}>
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
                  value={badgeId}
                  onChange={(e) => setBadgeId(e.target.value)}
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
              <Button onClick={doAssign} disabled={busy || !badgeId.trim()}>
                <CheckIcon className="size-4" />
                {t("checkIn")}
              </Button>
            </SectionCard>
          )}
        </div>
      )}
    </div>
  );
}
