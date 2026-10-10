"use client";

// One company tag (#935) in a dense list: kind icon, optional staff label,
// the serial number (NFC) or shortened token (QR), and a copy button for the
// full code.

import { ContactlessPaymentIcon } from "@phosphor-icons/react/dist/csr/ContactlessPayment";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { QrCodeIcon } from "@phosphor-icons/react/dist/csr/QrCode";
import { IconButton } from "@/components/common/icon-button";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useLocale } from "@/lib/i18n";
import { displayCode, type StandTag } from "@/lib/stands";
import { cn } from "@/lib/utils";

export function CompanyTagChip({ tag, className }: { tag: StandTag; className?: string }) {
  const { t } = useLocale();
  const copy = useCopyToClipboard({ title: "standTagCopyCode", failure: "standTagCouldNotCopy" });
  const Icon = tag.kind === "nfc" ? ContactlessPaymentIcon : QrCodeIcon;
  const kind = t(tag.kind === "nfc" ? "standTagNfc" : "standTagQr");
  return (
    <span
      className={cn(
        "bg-muted/60 inline-flex max-w-full items-center gap-1.5 rounded-md border py-0.5 pr-0.5 pl-2 text-xs",
        className,
      )}
      title={tag.code}
    >
      <Icon aria-label={kind} className="text-muted-foreground size-3.5 shrink-0" />
      {tag.label && <span className="truncate font-medium">{tag.label}</span>}
      <span className="text-muted-foreground font-mono tabular-nums">{displayCode(tag)}</span>
      <IconButton
        variant="ghost"
        size="icon-sm"
        className="size-6"
        label={t("standTagCopyCodeOf", { code: tag.label ?? displayCode(tag) })}
        onClick={(event) => {
          event.stopPropagation();
          void copy(tag.code);
        }}
      >
        <CopyIcon aria-hidden="true" className="size-3.5" />
      </IconButton>
    </span>
  );
}
