const normalizeOrigin = (value: string | undefined, fallback: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return /^https?:\/\//i.test(trimmed) ? trimmed.replace(/\/$/, "") : `https://${trimmed}`;
};

export const dynamic = "force-dynamic";

export function GET() {
  const config = {
    apiUrl: normalizeOrigin(
      process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? process.env.API_DOMAIN,
      "http://localhost:3000",
    ),
    siteUrl: normalizeOrigin(
      process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? process.env.WEB_DOMAIN,
      "http://localhost:3001",
    ),
  };

  return new Response(`window.__HACKOS_RUNTIME_CONFIG__=${JSON.stringify(config)};`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/javascript; charset=utf-8",
    },
  });
}
