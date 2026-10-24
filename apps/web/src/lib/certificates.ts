import { api, apiDownload } from "@/lib/api";
import type { Language } from "@/lib/types";

export type CertificateVariant = "participation" | "hours" | "activities";

export interface Certificate {
  id: number;
  code: string;
  userId: number;
  variant: CertificateVariant;
  locale: Language;
  issuedAt: string;
  revokedAt: string | null;
}

export interface CertificateEligibility {
  hours: number;
  eligible: boolean;
  reason: "not_available" | "hours_not_met" | "demo_required" | null;
}

export const CERTIFICATE_VARIANTS: CertificateVariant[] = ["participation", "hours", "activities"];

export interface CertificateOverview {
  eligibility: CertificateEligibility;
  certificates: Certificate[];
}

/** #1083: attendance certificates, as the participant and as staff. */
export const certificatesApi = {
  mine: () => api.get<CertificateOverview>("/api/me/certificates"),
  issueMine: (variant: CertificateVariant, locale: Language) =>
    api.post<Certificate>("/api/me/certificates", { variant, locale }),
  downloadMine: (id: number) =>
    apiDownload(`/api/me/certificates/${id}/pdf`, `certificate-${id}.pdf`),
  ofUser: (userId: number) => api.get<CertificateOverview>(`/api/users/${userId}/certificates`),
  issueFor: (
    userId: number,
    variant: CertificateVariant,
    locale: Language,
    overrideReason?: string,
  ) =>
    api.post<Certificate>("/api/certificates", {
      userId,
      variant,
      locale,
      overrideReason: overrideReason || null,
    }),
  revoke: (id: number, reason: string) =>
    api.post<Certificate>(`/api/certificates/${id}/revoke`, { reason }),
  /** Without the CSV footer; `copy` is what the participant gets. */
  download: (id: number, copy: boolean) =>
    apiDownload(`/api/certificates/${id}/pdf${copy ? "?copy=true" : ""}`, `certificate-${id}.pdf`),
};
