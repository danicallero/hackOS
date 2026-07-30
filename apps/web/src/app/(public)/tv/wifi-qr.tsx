"use client";

import { QRCodeSVG } from "qrcode.react";
import { useLocale } from "@/lib/i18n";
import { type TvVenueConfig, wifiJoinCode } from "@/lib/tv";
import { cn } from "@/lib/utils";

/**
 * "Point your camera at the screen to join" (H42). Rendered locally as an SVG:
 * a venue screen may have no internet — the Wi-Fi it is advertising is often
 * exactly what isn't working yet — and the password must not travel to a third
 * party to be turned into pixels.
 *
 * The white plate is not decoration. A QR needs a light background and a quiet
 * zone around it to scan, so it can't simply sit on a dark venue screen; the
 * plate carries both, and sizing in `em` keeps it proportional to whatever
 * screen the frame scaled itself to.
 */
export function WifiQr({
  wifi,
  className,
  size = "12em",
}: {
  wifi: NonNullable<TvVenueConfig["wifi"]>;
  className?: string;
  /** Edge length of the code itself, in `em` so it scales with the screen. */
  size?: string;
}) {
  const { t } = useLocale();
  return (
    <div className={cn("rounded-[0.75em] bg-white p-[0.75em] shadow-sm", className)}>
      <QRCodeSVG
        value={wifiJoinCode(wifi)}
        // Read from metres away by phones held at an angle: the stronger error
        // correction survives that better than the density saving is worth.
        level="Q"
        marginSize={0}
        bgColor="#ffffff"
        fgColor="#000000"
        title={t("wifiQrTitle")}
        style={{ width: size, height: size }}
      />
    </div>
  );
}
