import type { Metadata } from "next";
import { INDEXABLE_ROBOTS } from "@/lib/metadata";
import { PublicPage } from "./(public)/public-page";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  robots: INDEXABLE_ROBOTS,
};

export default function RootPage() {
  return <PublicPage />;
}
