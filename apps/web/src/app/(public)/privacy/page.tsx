import type { Metadata } from "next";
import { LocalizedLegalDocument } from "@/components/legal/localized-legal-document";
import { privacyCopy } from "@/components/legal/privacy-copy";
import { INDEXABLE_ROBOTS } from "@/lib/metadata";

export const metadata: Metadata = {
  alternates: { canonical: "/privacy" },
  robots: INDEXABLE_ROBOTS,
  title: "Política de privacidad | hackOS",
  description: "Información sobre el tratamiento de datos personales en hackOS.",
};

export default function PrivacyPage() {
  return <LocalizedLegalDocument copy={privacyCopy} />;
}
