import { api, apiDownload } from "@/lib/api";
import type { Language } from "@/lib/types";

export type CertificateVariant = "participation" | "hours" | "activities";

export interface CertificateSettings {
  minHours: number | null;
  minReviewHours: number | null;
  awardHours: number | null;
  requiresDemo: boolean;
  issuerName: string;
}

export interface Certificate {
  id: number;
  code: string;
  userId: number | null;
  typeId: number;
  typeName: string | null;
  recipientName: string;
  activityName: string;
  variant: CertificateVariant;
  locale: Language;
  issuedAt: string;
  revokedAt: string | null;
}

export interface CertificateEligibility {
  hours: number;
  certifiedHours: number | null;
  reviewRequired: boolean;
  approval: {
    certifiedHours: number;
    reason: string;
    approvedBy: number | null;
    approvedAt: string;
  } | null;
  eligible: boolean;
  reason: "not_available" | "hours_not_met" | "demo_required" | "review_required" | null;
}

export const CERTIFICATE_VARIANTS: CertificateVariant[] = ["participation", "hours", "activities"];

export interface CertificateOverview {
  settings?: CertificateSettings;
  types?: CertificateType[];
  eligibility: CertificateEligibility;
  certificates: Certificate[];
}

export interface CertificateParticipant {
  userId: number;
  name: string;
  surname: string | null;
  universityId: number | null;
  universityName: string | null;
  eligibility: CertificateEligibility;
}

/** #1083: attendance certificates, as the participant and as staff. */
export const certificatesApi = {
  downloadEvidence: (userId: number) =>
    apiDownload(
      `/api/presence/hours/${userId}/export.csv?format=full`,
      `attendance-evidence-${userId}.csv`,
    ),
  participants: () =>
    api.get<{ items: CertificateParticipant[] }>("/api/certificates/participants"),
  approve: (userId: number, certifiedHours: number, reason: string) =>
    api.post<CertificateEligibility>(`/api/users/${userId}/certificate-approval`, {
      certifiedHours,
      reason,
    }),
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

export type CertificateText = Record<Language, string>;
export interface CertificateTypeInput {
  name: CertificateText;
  title: CertificateText;
  body: CertificateText | null;
  enabled: boolean;
  attendancePolicy: boolean;
  selfService: boolean;
  audienceRoleIds: number[] | null;
  allowGuests: boolean;
  identityPolicy: "none" | "optional" | "required";
  requiresActivity: boolean;
}
export interface CertificateType extends CertificateTypeInput {
  id: number;
  revision: number;
  legacyVariant: CertificateVariant | "accepted_spot" | null;
}
export interface CertificateIssueInput {
  typeId: number;
  locale: Language;
  userId?: number;
  guestName?: string;
  documentKind?: "dni_nie" | "passport";
  documentNumber?: string;
  includeIdentification?: boolean;
  activityName?: string;
  certifiedHours?: number;
  overrideReason?: string;
}
export const certificateTypesApi = {
  list: () =>
    api.get<{ items: CertificateType[]; roles: { id: number; name: string }[] }>(
      "/api/certificates/types",
    ),
  create: (definition: CertificateTypeInput) =>
    api.post<CertificateType>("/api/certificates/types", { ...definition }),
  update: (id: number, revision: number, definition: CertificateTypeInput) =>
    api.put<CertificateType>(`/api/certificates/types/${id}`, { revision, definition }),
  issue: (input: CertificateIssueInput) =>
    api.post<Certificate>("/api/certificates/issue", { ...input }),
  issueMine: (typeId: number, locale: Language) =>
    api.post<Certificate>("/api/me/certificates/issue", { typeId, locale }),
  issued: () => api.get<{ items: Certificate[] }>("/api/certificates/issued"),
};
