"use client";

import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

export function GenerateQueuesAction({
  busy,
  onGenerate,
}: {
  busy: boolean;
  onGenerate: () => void;
}) {
  const statusId = useId();
  const { t } = useLocale();

  return (
    <>
      <Button
        size="sm"
        onClick={onGenerate}
        disabled={busy}
        aria-busy={busy}
        aria-describedby={busy ? statusId : undefined}
        loading={busy}
      >
        <ArrowsClockwiseIcon aria-hidden="true" className="size-4" />
        {t("generateQueues")}
      </Button>
      {busy && (
        <span id={statusId} role="status" className="type-meta text-pretty">
          {t("generatingQueues")}
        </span>
      )}
    </>
  );
}
