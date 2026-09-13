import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import { Providers } from "@/components/providers";
import { getSiteUrl, SITE_DESCRIPTION, SITE_TITLE, SOCIAL_IMAGE_PATH } from "@/lib/metadata";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const requestOrigin = forwardedHost
    ? `${forwardedProtocol ?? "https"}://${forwardedHost.split(",")[0]?.trim()}`
    : undefined;
  const siteUrl = getSiteUrl(requestOrigin);

  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: SITE_TITLE,
      template: "%s | hackOS",
    },
    description: SITE_DESCRIPTION,
    applicationName: "hackOS",
    alternates: {
      canonical: "/",
    },
    openGraph: {
      type: "website",
      url: "/",
      siteName: "hackOS",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [
        {
          url: SOCIAL_IMAGE_PATH,
          width: 1200,
          height: 630,
          alt: SITE_TITLE,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [SOCIAL_IMAGE_PATH],
    },
  };
}

/*
 * Keep the root layout itself small; generateMetadata above is request-aware
 * so static image promotion does not bake one environment's canonical origin.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      data-locale-ready="false"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <Script src="/runtime-config.js" strategy="beforeInteractive" />
        <Script src="/locale-bootstrap.js" strategy="beforeInteractive" />
      </head>
      <body className="bg-background text-foreground min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
