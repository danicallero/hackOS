// Digital Asset Links for Android App Links (#935), served at
// /.well-known/assetlinks.json through a rewrite in next.config.ts. It lets
// the app verify `https://<web host>/s/<code>` company-tag links (NFC tags
// and printed QR codes) and open them directly. The signing-certificate
// fingerprints are deployment configuration (`ANDROID_APP_CERT_SHA256`).
import { assetLinks } from "@/lib/app-links";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(assetLinks(process.env.ANDROID_APP_CERT_SHA256), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
