import { api, apiDownload } from "@/lib/api";
import type { Language } from "@/lib/types";

type CertificateVariant = "participation" | "hours" | "activities";

export interface CertificateSettings {
  minHours: number | null;
  minReviewHours: number | null;
  awardHours: number | null;
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
  /** The edition the certificate was issued for. */
  edition?: { eventKey: string; name: string };
  revokedAt: string | null;
  supersededAt: string | null;
  /** Attendance changed since it was issued; Update replaces it with a new document. */
  outdated: boolean;
}

interface CertificateEligibility {
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
  reason: "not_available" | "hours_not_met" | "review_required" | null;
}

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

export interface CertificateEditionGroup {
  key: string;
  name: string;
  certificates: Certificate[];
}

/**
 * Valid certificates grouped by edition, newest edition first, or null when
 * they belong to at most one edition (the plain per-type list applies then).
 */
export function groupCertificatesByEdition(
  certificates: Certificate[],
): CertificateEditionGroup[] | null {
  const groups = new Map<string, CertificateEditionGroup>();
  const newestFirst = [...certificates]
    .filter((cert) => cert.edition && !cert.revokedAt && !cert.supersededAt)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  for (const cert of newestFirst) {
    const edition = cert.edition as { eventKey: string; name: string };
    const group = groups.get(edition.eventKey) ?? {
      key: edition.eventKey,
      name: edition.name,
      certificates: [],
    };
    group.certificates.push(cert);
    groups.set(edition.eventKey, group);
  }
  return groups.size > 1 ? [...groups.values()] : null;
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
  downloadMine: (id: number) =>
    apiDownload(`/api/me/certificates/${id}/pdf`, `certificate-${id}.pdf`),
  ofUser: (userId: number) => api.get<CertificateOverview>(`/api/users/${userId}/certificates`),
  revoke: (id: number, reason: string) =>
    api.post<Certificate>(`/api/certificates/${id}/revoke`, { reason }),
  /** The certificate's single stored copy, the same file its owner gets. */
  download: (id: number) => apiDownload(`/api/certificates/${id}/pdf`, `certificate-${id}.pdf`),
};

type CertificateText = Record<Language, string>;
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
  requiresEventEnd: boolean;
  demoRequirement: "none" | "any" | "mandatory" | "challenge";
  demoChallengeId: number | null;
  exemptRoleIds: number[] | null;
}
export interface CertificateType extends CertificateTypeInput {
  id: number;
  revision: number;
  /** Why it cannot be issued to this person yet; null when available (only on a person's overview). */
  availability?: string | null;
  legacyVariant: CertificateVariant | "accepted_spot" | null;
}
interface CertificateIssueInput {
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
  refresh?: boolean;
}
export const certificateTypesApi = {
  list: () =>
    api.get<{
      items: CertificateType[];
      roles: { id: number; name: string }[];
      challenges: { id: number; title: string; mandatory: boolean }[];
    }>("/api/certificates/types"),
  create: (definition: CertificateTypeInput) =>
    api.post<CertificateType>("/api/certificates/types", { ...definition }),
  update: (id: number, revision: number, definition: CertificateTypeInput) =>
    api.put<CertificateType>(`/api/certificates/types/${id}`, { revision, definition }),
  issue: (input: CertificateIssueInput) =>
    api.post<Certificate>("/api/certificates/issue", { ...input }),
  issueMine: (typeId: number, locale: Language, refresh = false) =>
    api.post<Certificate>("/api/me/certificates/issue", { typeId, locale, refresh }),
  issued: () => api.get<{ items: Certificate[] }>("/api/certificates/issued"),
};
