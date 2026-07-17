"use client";

import { RefreshCwIcon } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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
        onClick={onGenerate}
        disabled={busy}
        aria-busy={busy}
        aria-describedby={busy ? statusId : undefined}
      >
        <RefreshCwIcon
          aria-hidden="true"
          className={cn("size-4", busy && "motion-safe:animate-spin")}
        />
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
