import { ImageResponse } from "next/og";
import { BRAND_IMAGE_PATH, SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/metadata";

export const runtime = "edge";
export const alt = SITE_TITLE;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const hostname = new URL(SITE_URL).hostname;
  const brandImageUrl = new URL(BRAND_IMAGE_PATH, SITE_URL).toString();

  return new ImageResponse(
    <div
      style={{
        backgroundColor: "#141414",
        color: "#f5f5f5",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        padding: "72px",
        width: "100%",
      }}
    >
      <div style={{ alignItems: "center", display: "flex", gap: "28px" }}>
        <div
          style={{
            alignItems: "center",
            borderRadius: "28px",
            display: "flex",
            height: "132px",
            justifyContent: "center",
            overflow: "hidden",
            width: "132px",
          }}
        >
          {/* biome-ignore lint/performance/noImgElement: next/og requires a native image element. */}
          <img alt={SITE_TITLE} height={132} src={brandImageUrl} width={132} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "76px", fontWeight: 700, lineHeight: 1 }}>hackOS</div>
          <div style={{ color: "#b8b8b8", fontSize: "30px" }}>Hackathon management</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ fontSize: "36px", lineHeight: 1.2, maxWidth: "920px" }}>
          {SITE_DESCRIPTION}
        </div>
        <div style={{ color: "#b8b8b8", fontSize: "24px" }}>
          Applications · Projects · Schedule · Judging · Communications
        </div>
        <div style={{ color: "#808080", fontSize: "22px" }}>{hostname}</div>
      </div>
    </div>,
    { ...size },
  );
}
