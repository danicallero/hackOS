import type { Metadata } from "next";
import { LocalizedLegalDocument } from "@/components/legal/localized-legal-document";
import { termsCopy } from "@/components/legal/terms-copy";

export const metadata: Metadata = {
  title: "Términos y condiciones | hackOS",
  description: "Términos y condiciones de acceso y uso de la plataforma hackOS.",
};

export default function TermsPage() {
  return <LocalizedLegalDocument copy={termsCopy} />;
}
