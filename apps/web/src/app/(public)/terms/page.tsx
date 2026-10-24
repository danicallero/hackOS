import type { Metadata } from "next";
import { LocalizedLegalDocument } from "@/components/legal/localized-legal-document";
import { termsCopy } from "@/components/legal/terms-copy";
import { INDEXABLE_ROBOTS } from "@/lib/metadata";

export const metadata: Metadata = {
  alternates: { canonical: "/terms" },
  robots: INDEXABLE_ROBOTS,
  title: "Términos y condiciones | hackOS",
  description: "Términos y condiciones de acceso y uso de la plataforma hackOS.",
};

export default function TermsPage() {
  return <LocalizedLegalDocument copy={termsCopy} />;
}
