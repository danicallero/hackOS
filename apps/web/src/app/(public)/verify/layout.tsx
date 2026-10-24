import type { Metadata } from "next";

// #1083: a certificate page is for whoever holds the code, never a search result.
export const metadata: Metadata = {
  title: "hackOS",
  description: undefined,
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
    nocache: true,
  },
};

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
