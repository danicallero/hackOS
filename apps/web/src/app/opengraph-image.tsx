import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/metadata";

export const runtime = "edge";
export const alt = SITE_TITLE;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const hostname = new URL(SITE_URL).hostname;

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
            backgroundColor: "#202020",
            border: "1px solid #383838",
            borderRadius: "28px",
            display: "flex",
            height: "132px",
            justifyContent: "center",
            width: "132px",
          }}
        >
          <svg height={98} viewBox="0 0 431.4 378" width={112}>
            <title>hackOS</title>
            <path
              fill="#f2f2f2"
              d="M111.09 378c-2.05 0-3.9-1.07-4.95-2.85L.79 195.99c-1.04-1.76-1.05-3.97-.04-5.75L106.63 2.93c1-1.8 2.92-2.93 5.02-2.93h208.41c2.04 0 3.96 1.1 5 2.87l105.59 182.17c1.01 1.75 1.02 3.94.01 5.72-1.05 1.83-2.92 2.91-5.02 2.91h-173.24v88.69h47.35c3.17 0 5.75 2.58 5.75 5.75v30.71c0 3.17-2.58 5.75-5.75 5.75h-165.3c-3.17 0-5.75-2.58-5.75-5.75v-29.8c0-3.17 2.58-5.75 5.75-5.75h39.02v-121.9c0-1.83.88-3.57 2.35-4.66l8.72-6.35v-28.94c0-1.69.74-3.29 2.02-4.37l7.68-6.57v-32.06c0-3.17 2.58-5.75 5.75-5.75s5.75 2.58 5.75 5.75v9.02l5.77-4.82c1.03-.86 2.35-1.34 3.71-1.34.19 0 .39 0 .58.03 1.56.16 2.96.93 3.93 2.17l10.16 12.92c.79.98 1.23 2.26 1.23 3.58v10.82l7.9 5.44c1.55 1.06 2.48 2.83 2.48 4.75v28.66c2.69 1.86 4.36 4.98 4.36 8.32 0 5.58-4.54 10.12-10.12 10.12s-10.12-4.54-10.12-10.12c0-3.22 1.54-6.26 4.13-8.13.08-.06.15-.11.23-.17v-25.64l-7.9-5.44c-1.54-1.01-2.48-2.8-2.48-4.75v-11.85l-5.27-6.69-8.62 7.18v10.69c0 1.69-.74 3.29-2.02 4.37l-7.68 6.57v29.21c0 1.83-.88 3.57-2.35 4.66l-8.72 6.35v124.75c0 3.17-2.58 5.75-5.75 5.75h-39.02v18.27h153.8v-19.2h-47.35c-3.17 0-5.75-2.58-5.75-5.75v-100.2c0-3.17 2.58-5.75 5.75-5.75h169.03L316.76 11.53H115.03L12.43 193.04l101.93 173.45h202.77l9.71-16.2h-189.29c-.18.26-.37.51-.57.75-1.9 2.28-4.72 3.59-7.71 3.59-5.58 0-10.12-4.54-10.12-10.12s4.54-10.12 10.12-10.12c3.34 0 6.46 1.67 8.32 4.36h199.46c2.06 0 3.98 1.12 5.01 2.92 1.04 1.81 1.01 4.04-.08 5.82l-16.61 27.7c-1.04 1.73-2.93 2.81-4.94 2.81H111.09Z"
            />
          </svg>
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
