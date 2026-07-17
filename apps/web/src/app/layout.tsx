import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import Script from "next/script";
import { Providers } from "@/components/providers";
import { LANGUAGE_COOKIE_MAX_AGE, LANGUAGE_PREFERENCE_KEY, resolveLanguage } from "@/lib/locale";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "hackOS",
  description: "Hackathon management platform",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const initialLanguage = resolveLanguage(cookieStore.get(LANGUAGE_PREFERENCE_KEY)?.value);
  const migrateLegacyPreference = `try{const key=${JSON.stringify(LANGUAGE_PREFERENCE_KEY)};const stored=localStorage.getItem(key);const hasCookie=document.cookie.split("; ").some((item)=>item.startsWith(key+"="));if(!hasCookie&&/^(es|gl|en)$/.test(stored||"")){document.cookie=key+"="+stored+"; Path=/; Max-Age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax";if(stored!==${JSON.stringify(initialLanguage)})location.reload();}}catch{}`;

  return (
    <html
      lang={initialLanguage}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <Script id="locale-preference-migration" strategy="beforeInteractive">
          {migrateLegacyPreference}
        </Script>
      </head>
      <body className="bg-background text-foreground min-h-full">
        <Providers initialLanguage={initialLanguage}>{children}</Providers>
      </body>
    </html>
  );
}
