"use client";

// Staff Stands page (#935): decide which sponsors attendees can collect by
// scanning, give every stand a code, and print them. `sponsors:manage` only.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { ContactlessPaymentIcon } from "@phosphor-icons/react/dist/csr/ContactlessPayment";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FileCsvIcon } from "@phosphor-icons/react/dist/csr/FileCsv";
import { FileZipIcon } from "@phosphor-icons/react/dist/csr/FileZip";
import { QrCodeIcon } from "@phosphor-icons/react/dist/csr/QrCode";
import { ScanIcon } from "@phosphor-icons/react/dist/csr/Scan";
import { StorefrontIcon } from "@phosphor-icons/react/dist/csr/Storefront";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import type { FilterDefinition } from "@/components/common/filter-menu";
import { IconButton } from "@/components/common/icon-button";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { StatusBadge } from "@/components/common/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { ApiError, api, apiDownload } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import { useCan } from "@/lib/session";
import { type StandSummary, type StandTag, standQrSvgPath } from "@/lib/stands";
import { toast } from "@/lib/toast";
import { isScheduled } from "../enterprises/shared";
import { LinkNfcDialog } from "./link-nfc-dialog";

type Busy = { id: number; action: "scannable" | "qr" | "download" } | null;

interface StandActions {
  busy: Busy;
  bulkBusy: boolean;
  onScannable: (stand: StandSummary, scannable: boolean) => void;
  onGenerateQr: (stand: StandSummary) => void;
  onLinkNfc: (stand: StandSummary) => void;
  onDownloadQr: (stand: StandSummary) => void;
}

function StandLogo({ stand, className }: { stand: StandSummary; className?: string }) {
  return (
    <Avatar size="sm" className={className}>
      {stand.logoUrl ? (
        <SponsorLogo
          logoUrl={stand.logoUrl}
          logoNegativeUrl={stand.logoNegativeUrl}
          alt=""
          className="size-full object-contain"
        />
      ) : (
        <AvatarFallback>{initials(stand.name)}</AvatarFallback>
      )}
    </Avatar>
  );
}

function VisibilityBadge({ stand, t }: { stand: StandSummary; t: Translate }) {
  if (stand.visibility === "visible")
    return <StatusBadge tone="success">{t("visibleLabel")}</StatusBadge>;
  if (isScheduled(stand.availableFrom))
    return <StatusBadge tone="warning">{t("dataStatusScheduled")}</StatusBadge>;
  return <StatusBadge tone="neutral">{t("hiddenOption")}</StatusBadge>;
}

function ScannableSwitch({
  stand,
  actions,
  t,
}: {
  stand: StandSummary;
  actions: StandActions;
  t: Translate;
}) {
  const pending = actions.busy?.id === stand.enterpriseId && actions.busy.action === "scannable";
  return (
    <Switch
      checked={stand.scannable}
      disabled={pending || actions.bulkBusy}
      aria-busy={pending || undefined}
      aria-label={t("standScannableFor", { name: stand.name })}
      onCheckedChange={(checked) => actions.onScannable(stand, checked)}
    />
  );
}

/** A count cell; the column header names it for assistive technology. */
function CodeCount({ value }: { value: number }) {
  return (
    <span className={value === 0 ? "text-muted-foreground tabular-nums" : "tabular-nums"}>
      {value}
    </span>
  );
}

function RowMenu({
  stand,
  actions,
  t,
}: {
  stand: StandSummary;
  actions: StandActions;
  t: Translate;
}) {
  const busy = actions.busy?.id === stand.enterpriseId;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="icon-lg"
          className="md:size-[var(--control-height-compact)]"
          label={t("standActionsFor", { name: stand.name })}
          disabled={busy}
          loading={busy}
        >
          <DotsThreeIcon aria-hidden="true" className="size-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => actions.onGenerateQr(stand)}>
          <QrCodeIcon aria-hidden="true" />
          {t("standTagGenerateQr")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onLinkNfc(stand)}>
          <ContactlessPaymentIcon aria-hidden="true" />
          {t("standTagLinkNfc")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={stand.latestQrTagId === null}
          onSelect={() => actions.onDownloadQr(stand)}
        >
          <DownloadSimpleIcon aria-hidden="true" />
          {t("standDownloadQrSvg")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/enterprises/${stand.enterpriseId}?tab=stand`}>
            <ArrowSquareOutIcon aria-hidden="true" />
            {t("standOpenEnterprise")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function buildColumns(t: Translate, actions: StandActions): Column<StandSummary>[] {
  return [
    {
      id: "name",
      header: t("enterprises"),
      sortValue: (s) => s.name.toLowerCase(),
      cell: (s) => (
        <div className="flex min-w-0 items-center gap-3">
          <StandLogo stand={s} />
          <Link
            href={`/enterprises/${s.enterpriseId}?tab=stand`}
            className="focus-visible:ring-ring truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2"
          >
            {s.name}
          </Link>
        </div>
      ),
    },
    {
      id: "visibility",
      header: t("colVisibility"),
      sortValue: (s) => s.visibility,
      cell: (s) => <VisibilityBadge stand={s} t={t} />,
    },
    {
      id: "scannable",
      header: t("standScannable"),
      sortValue: (s) => (s.scannable ? 0 : 1),
      cell: (s) => <ScannableSwitch stand={s} actions={actions} t={t} />,
    },
    {
      id: "nfc",
      header: t("standNfcColumn"),
      align: "right",
      width: "w-20",
      sortValue: (s) => s.nfcCount,
      cell: (s) => <CodeCount value={s.nfcCount} />,
    },
    {
      id: "qr",
      header: t("standQrColumn"),
      align: "right",
      width: "w-20",
      sortValue: (s) => s.qrCount,
      cell: (s) => <CodeCount value={s.qrCount} />,
    },
  ];
}

function StandMobileRow({
  stand,
  actions,
  t,
}: {
  stand: StandSummary;
  actions: StandActions;
  t: Translate;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3">
      <StandLogo stand={stand} className="size-9" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Link
          href={`/enterprises/${stand.enterpriseId}?tab=stand`}
          className="focus-visible:ring-ring block truncate rounded-sm font-medium outline-none focus-visible:ring-2"
        >
          {stand.name}
        </Link>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <VisibilityBadge stand={stand} t={t} />
          <span className="inline-flex items-center gap-1 tabular-nums">
            <ContactlessPaymentIcon aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{t("standNfcColumn")}:</span>
            {stand.nfcCount}
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <QrCodeIcon aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{t("standQrColumn")}:</span>
            {stand.qrCount}
          </span>
        </div>
      </div>
      <ScannableSwitch stand={stand} actions={actions} t={t} />
      <RowMenu stand={stand} actions={actions} t={t} />
    </div>
  );
}

function errorText(err: unknown, t: Translate, fallback: Parameters<Translate>[0]): string {
  if (err instanceof ApiError && err.code === "stand_codes_empty")
    return t("standsNothingToExport");
  return err instanceof ApiError ? err.message : t(fallback);
}

export default function StandsPage() {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const canManage = useCan(CAPABILITIES.SPONSORS_MANAGE);
  const [stands, setStands] = useState<StandSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoaded = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [bulkBusy, setBulkBusy] = useState<"generate" | "zip" | "csv" | null>(null);
  const [generated, setGenerated] = useState<string[] | null>(null);
  const [linking, setLinking] = useState<StandSummary | null>(null);
  const [q, setQ] = usePersistedState("stands-list:q", "");
  const [scanFilter, setScanFilter] = usePersistedState<string[]>("stands-list:scannable", []);
  const [codeFilter, setCodeFilter] = usePersistedState<string[]>("stands-list:codes", []);
  const [visibilityFilter, setVisibilityFilter] = usePersistedState<string[]>(
    "stands-list:visibility",
    [],
  );

  const load = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<{ stands: StandSummary[] }>("/api/enterprises/stands");
      hasLoaded.current = true;
      setStands(data.stands);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("standsCouldNotLoad");
      setLoadError(message);
      if (!hasLoaded.current) setStands([]);
      toast.error(message, t("stands"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const liveRefresh = useAutoRefresh("/api/events/stream?topic=sponsors", [EVENTS.DOMAIN_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (canManage) void load();
  }, [canManage, load, liveRefresh]);

  const patch = useCallback((enterpriseId: number, change: Partial<StandSummary>) => {
    setStands((current) =>
      current.map((stand) =>
        stand.enterpriseId === enterpriseId ? { ...stand, ...change } : stand,
      ),
    );
  }, []);

  const actions: StandActions = useMemo(
    () => ({
      busy,
      bulkBusy: bulkBusy === "generate",
      async onScannable(stand, scannable) {
        setBusy({ id: stand.enterpriseId, action: "scannable" });
        patch(stand.enterpriseId, { scannable });
        try {
          await api.put(`/api/enterprises/${stand.enterpriseId}/stand-scannable`, { scannable });
          toast.success(
            t(scannable ? "standScanningOnFor" : "standScanningOffFor", { name: stand.name }),
            { compactTitle: t("standScannable") },
          );
        } catch (err) {
          patch(stand.enterpriseId, { scannable: stand.scannable });
          toast.error(
            err instanceof ApiError ? err.message : t("standCouldNotUpdateScannable"),
            t("standScannable"),
          );
        } finally {
          setBusy(null);
        }
      },
      async onGenerateQr(stand) {
        setBusy({ id: stand.enterpriseId, action: "qr" });
        try {
          const tag = await api.post<StandTag>(
            `/api/enterprises/${stand.enterpriseId}/stand-tags`,
            {
              kind: "qr",
            },
          );
          patch(stand.enterpriseId, { qrCount: stand.qrCount + 1, latestQrTagId: tag.id });
          toast.success(t("standQrGeneratedFor", { name: stand.name }), {
            compactTitle: t("standTagGenerateQr"),
          });
        } catch (err) {
          toast.error(
            err instanceof ApiError ? err.message : t("standTagCouldNotAdd"),
            t("standTagGenerateQr"),
          );
        } finally {
          setBusy(null);
        }
      },
      onLinkNfc(stand) {
        setLinking(stand);
      },
      async onDownloadQr(stand) {
        if (stand.latestQrTagId === null) return;
        setBusy({ id: stand.enterpriseId, action: "download" });
        try {
          await apiDownload(
            standQrSvgPath(stand.enterpriseId, stand.latestQrTagId),
            `${stand.name}.svg`,
          );
        } catch (err) {
          toast.error(
            err instanceof ApiError ? err.message : t("standQrCouldNotDownload"),
            t("standDownloadQrSvg"),
          );
        } finally {
          setBusy(null);
        }
      },
    }),
    [busy, bulkBusy, patch, t],
  );

  const columns = useMemo(() => buildColumns(t, actions), [t, actions]);

  const scannable = stands.filter((stand) => stand.scannable);
  const missingQr = scannable.filter((stand) => stand.qrCount === 0).length;
  const printableQr = scannable.some((stand) => stand.qrCount > 0);
  const exportable = scannable.some((stand) => stand.qrCount + stand.nfcCount > 0);

  async function generateMissing() {
    setBulkBusy("generate");
    try {
      const result = await api.post<{
        created: { enterpriseId: number; name: string; tag: StandTag }[];
      }>("/api/enterprises/stands/qr");
      if (result.created.length === 0) {
        setGenerated(null);
        toast.info(t("standsAllHaveQr"));
      } else {
        setGenerated(result.created.map((item) => item.name));
        setStands((current) =>
          current.map((stand) => {
            const created = result.created.find((item) => item.enterpriseId === stand.enterpriseId);
            return created
              ? { ...stand, qrCount: stand.qrCount + 1, latestQrTagId: created.tag.id }
              : stand;
          }),
        );
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("standsCouldNotGenerate"),
        t("standsGenerateMissingQr"),
      );
    } finally {
      setBulkBusy(null);
    }
  }

  async function download(kind: "zip" | "csv") {
    setBulkBusy(kind);
    try {
      if (kind === "zip") {
        await apiDownload("/api/enterprises/stands/qr.zip", "stand-qr-codes.zip");
      } else {
        await apiDownload("/api/enterprises/stands/codes.csv", "stand-codes.csv");
      }
    } catch (err) {
      toast.error(
        errorText(err, t, "exportFailed"),
        t(kind === "zip" ? "standsDownloadAllQr" : "standsExportCodes"),
      );
    } finally {
      setBulkBusy(null);
    }
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLocaleLowerCase();
    return stands.filter((stand) => {
      if (query && !stand.name.toLocaleLowerCase().includes(query)) return false;
      if (
        scanFilter.length > 0 &&
        !scanFilter.includes(stand.scannable ? "scannable" : "notScannable")
      )
        return false;
      if (visibilityFilter.length > 0 && !visibilityFilter.includes(stand.visibility)) return false;
      if (codeFilter.length > 0) {
        const matches =
          (codeFilter.includes("noQr") && stand.qrCount === 0) ||
          (codeFilter.includes("hasQr") && stand.qrCount > 0) ||
          (codeFilter.includes("hasNfc") && stand.nfcCount > 0) ||
          (codeFilter.includes("noCodes") && stand.qrCount + stand.nfcCount === 0);
        if (!matches) return false;
      }
      return true;
    });
  }, [stands, q, scanFilter, visibilityFilter, codeFilter]);

  const hasFilters =
    q.trim().length > 0 ||
    scanFilter.length > 0 ||
    visibilityFilter.length > 0 ||
    codeFilter.length > 0;

  function clearFilters() {
    setQ("");
    setScanFilter([]);
    setVisibilityFilter([]);
    setCodeFilter([]);
    document.getElementById("stand-search")?.focus();
  }

  const filters: FilterDefinition[] = [
    {
      id: "scannable",
      label: t("standScannable"),
      icon: ScanIcon,
      type: "multiple",
      value: scanFilter,
      onChange: (values) => setScanFilter([...values]),
      options: [
        { value: "scannable", label: t("standScannable") },
        { value: "notScannable", label: t("standNotScannable") },
      ],
    },
    {
      id: "codes",
      label: t("standCodes"),
      icon: QrCodeIcon,
      type: "multiple",
      value: codeFilter,
      onChange: (values) => setCodeFilter([...values]),
      options: [
        { value: "noQr", label: t("standFilterNoQr") },
        { value: "hasQr", label: t("standFilterHasQr") },
        { value: "hasNfc", label: t("standFilterHasNfc") },
        { value: "noCodes", label: t("standFilterNoCodes") },
      ],
    },
    {
      id: "visibility",
      label: t("colVisibility"),
      icon: EyeIcon,
      type: "multiple",
      value: visibilityFilter,
      onChange: (values) => setVisibilityFilter([...values]),
      options: [
        { value: "visible", label: t("visibleLabel") },
        { value: "hidden", label: t("hiddenOption") },
      ],
    },
  ];

  if (!canManage) return <AccessDenied ask={t("sponsorsAccessDeniedDesc")} />;

  const generateLabel =
    missingQr > 0
      ? t("standsGenerateMissingQrCount", { count: missingQr })
      : t("standsGenerateMissingQr");

  return (
    <PageLayout>
      <PageHeader
        className="flex-row items-center justify-between gap-2 md:items-center"
        title={t("stands")}
        state={
          stands.length > 0 ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {t("standsScannableCount", { count: scannable.length, total: stands.length })}
            </span>
          ) : undefined
        }
        secondaryActions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={t("moreActions")}
                variant="outline"
                loading={bulkBusy === "zip" || bulkBusy === "csv"}
                disabled={bulkBusy !== null}
              >
                <DotsThreeIcon aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!printableQr} onSelect={() => void download("zip")}>
                <FileZipIcon aria-hidden="true" />
                {t("standsDownloadAllQr")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!exportable} onSelect={() => void download("csv")}>
                <FileCsvIcon aria-hidden="true" />
                {t("standsExportCodes")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        primaryAction={
          isMobile ? (
            <IconButton
              label={generateLabel}
              disabled={missingQr === 0 || bulkBusy !== null}
              loading={bulkBusy === "generate"}
              onClick={() => void generateMissing()}
            >
              <QrCodeIcon aria-hidden="true" />
            </IconButton>
          ) : (
            <Button
              disabled={missingQr === 0 || bulkBusy !== null}
              loading={bulkBusy === "generate"}
              onClick={() => void generateMissing()}
            >
              <QrCodeIcon aria-hidden="true" className="size-4" />
              {generateLabel}
            </Button>
          )
        }
      />

      <div className="space-y-4">
        {generated && (
          <div
            role="status"
            className="bg-card flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"
          >
            <QrCodeIcon aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium">
                {generated.length === 1
                  ? t("standsGeneratedOne")
                  : t("standsGeneratedOther", { count: generated.length })}
              </p>
              <p className="text-muted-foreground wrap-break-word">{generated.join(", ")}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={bulkBusy !== null}
                loading={bulkBusy === "zip"}
                onClick={() => void download("zip")}
              >
                <FileZipIcon aria-hidden="true" className="size-4" />
                {t("standsDownloadAllQr")}
              </Button>
            </div>
            <IconButton
              variant="ghost"
              size="icon-sm"
              label={t("dismiss")}
              onClick={() => setGenerated(null)}
            >
              <XIcon aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
        )}

        <ListToolbar
          search={{ id: "stand-search", label: t("standsSearch"), value: q, onValueChange: setQ }}
          filters={filters}
        />
        {hasFilters && (
          <span
            role="status"
            aria-live="polite"
            className="text-muted-foreground block text-xs tabular-nums"
          >
            {t("tableResultCount", { count: filtered.length })}
          </span>
        )}

        <DataTable
          columns={columns}
          data={filtered}
          getRowId={(s) => String(s.enterpriseId)}
          stateKey="stands-list"
          rowActions={(s) => <RowMenu stand={s} actions={actions} t={t} />}
          renderMobileRow={(s) => <StandMobileRow stand={s} actions={actions} t={t} />}
          pageSize={25}
          loading={loading}
          error={
            loadError && !hasLoaded.current ? { message: loadError, onRetry: load } : undefined
          }
          empty={{ icon: StorefrontIcon, title: t("noEnterprisesYetTitle") }}
          filteredEmpty={{ active: hasFilters, onClear: clearFilters }}
        />
      </div>

      <LinkNfcDialog
        stand={linking}
        onOpenChange={(open) => {
          if (!open) setLinking(null);
        }}
        onLinked={(stand) => {
          setLinking(null);
          patch(stand.enterpriseId, { nfcCount: stand.nfcCount + 1 });
        }}
      />
    </PageLayout>
  );
}
