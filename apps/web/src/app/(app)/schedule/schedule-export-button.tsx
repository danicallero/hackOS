"use client";

// H48/H59: "Export CSV" for the staff roster. Client-side on purpose — the rows
// are already loaded and filtered in the page, and a CSV of what the viewer can
// already see on screen adds no data to audit (H53).

import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FileCsvIcon } from "@phosphor-icons/react/dist/csr/FileCsv";
import { useState } from "react";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { downloadCsv } from "@/lib/csv";
import { useLocale } from "@/lib/i18n";
import type { PublicScheduleItem } from "@/lib/logistics";
import { buildScheduleCsv, defaultExportColumns, scheduleCsvFilename } from "./schedule-export";
import { COLUMN_LABEL_KEYS, type ColumnId, type TableConfig } from "./schedule-table-config";

export function ScheduleExportButton({
  items,
  config,
}: {
  /** The rows currently shown: search and filters already applied. */
  items: PublicScheduleItem[];
  config: TableConfig;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FileCsvIcon aria-hidden="true" className="size-4" />
        {t("exportCsvAction")}
      </Button>
      {open && (
        <ScheduleExportDialog items={items} config={config} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ScheduleExportDialog({
  items,
  config,
  onClose,
}: {
  items: PublicScheduleItem[];
  config: TableConfig;
  onClose: () => void;
}) {
  const { t, language } = useLocale();
  const [selected, setSelected] = useState<Set<ColumnId>>(
    () => new Set(defaultExportColumns(config)),
  );
  // Always in the roster's current column order, whatever the click order was.
  const columns = config.order.filter((id) => selected.has(id));

  function exportCsv() {
    downloadCsv(scheduleCsvFilename(), buildScheduleCsv(items, columns, { t, language }));
    onClose();
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("exportCsvAction")}
      icon={FileCsvIcon}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={exportCsv} disabled={columns.length === 0}>
            <DownloadSimpleIcon aria-hidden="true" />
            {t("export")}
          </Button>
        </>
      }
    >
      <fieldset className="grid gap-1">
        <legend className="sr-only">{t("columnsAction")}</legend>
        {config.order.map((id) => (
          <label
            key={id}
            htmlFor={`export-col-${id}`}
            className="flex min-h-9 items-center gap-2 rounded-control px-2 py-1.5 text-sm hover:bg-muted/50"
          >
            <Checkbox
              id={`export-col-${id}`}
              checked={selected.has(id)}
              onCheckedChange={(checked) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (checked === true) next.add(id);
                  else next.delete(id);
                  return next;
                })
              }
            />
            <span>{t(COLUMN_LABEL_KEYS[id])}</span>
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}
