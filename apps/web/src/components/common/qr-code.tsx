import { CopyIcon } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  if (!value) {
    return (
      <div className={cn("rounded-lg border p-4 text-center", className)}>
        <p className="text-muted-foreground text-sm">No {label.toLowerCase()} available.</p>
      </div>
    );
  }

  const src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodeURIComponent(value)}`;

  return (
    <div className={cn("rounded-lg border p-4", className)}>
      <div className="flex flex-col items-center gap-3">
        <Image
          src={src}
          alt={`${label} QR`}
          width={220}
          height={220}
          unoptimized
          className="bg-white rounded-md border p-2"
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
              toast.success("Copied.");
            }}
          >
            <CopyIcon className="size-4" />
            Copy
          </Button>
        </div>
      </div>
    </div>
  );
}
