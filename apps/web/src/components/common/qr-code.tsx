import { CopyIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function QrCode({
  value,
  label,
  className,
}: {
  value: string | null | undefined;
  label: string;
  className?: string;
}) {
  const { t } = useLocale();
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
              void navigator.clipboard.writeText(value);
              toast.success(t("copied"));
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
