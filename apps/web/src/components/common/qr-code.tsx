import { CopyIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** QR code card with the encoded value shown as text and a copy button. */
export function QrCode({
  value,
  label,
  className,
}: {
  /** Encoded content; renders a "not available" placeholder card when null/undefined. */
  value: string | null | undefined;
  /** Caption under the code and title on the SVG, e.g. the ticket/badge id. */
  label: string;
  className?: string;
}) {
  const { t } = useLocale();
  const copyToClipboard = useCopyToClipboard();
  if (!value) {
    return (
      <div className={cn("rounded-lg border p-4 text-center", className)}>
        <p className="text-muted-foreground text-sm">{t("qrNotAvailable", { item: label })}</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border p-4", className)}>
      <div className="flex flex-col items-center gap-3">
        <QRCodeSVG
          value={value}
          title={`${label} QR`}
          level="Q"
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#000000"
          size={220}
          className="rounded-md border bg-white p-2"
        />
        <div className="w-full space-y-2">
          <p className="text-muted-foreground text-xs">{label}</p>
          <code className="bg-muted block overflow-x-auto rounded-md px-2 py-1 font-mono text-xs">
            {value}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              void copyToClipboard(value);
            }}
          >
            <CopyIcon className="size-4" />
            {t("copy")}
          </Button>
        </div>
      </div>
    </div>
  );
}
