import type { Metadata } from "next";
import { LocalizedLegalDocument } from "@/components/legal/localized-legal-document";
import { privacyCopy } from "@/components/legal/privacy-copy";

export const metadata: Metadata = {
  title: "Política de privacidad | hackOS",
  description: "Información sobre el tratamiento de datos personales en hackOS.",
};

export default function PrivacyPage() {
  return <LocalizedLegalDocument copy={privacyCopy} />;
}
