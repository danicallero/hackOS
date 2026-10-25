import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { ApiError, apiFetch } from "./api";
import type { MessageKey } from "./i18n";
import { createIdempotencyKey } from "./idempotency-key";
import type { NetworkingProfile } from "./networking-profile";

/**
 * The uploaded CV (#935), as POST/DELETE /api/me/public-profile/cv: one PDF up
 * to 5 MB under multipart `file`. A CV taken from the person's application
 * wins server-side and is read-only (409 here), so the editor never offers
 * these actions for it.
 */
export const CV_FIELD_NAME = "file";
export const CV_MAX_BYTES = 5 * 1024 * 1024;
const CV_PATH = "/api/me/public-profile/cv";

/** A picked file the API would reject, caught before uploading. */
export class CvRejectedError extends Error {
  constructor(readonly reason: "tooLarge" | "notPdf") {
    super(reason);
    this.name = "CvRejectedError";
  }
}

export interface PickedCv {
  uri: string;
  name: string;
}

/** Opens the system file picker for a PDF; null when the person cancels. */
export async function pickCv(): Promise<PickedCv | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "application/pdf",
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const isPdf = asset.mimeType === "application/pdf" || asset.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) throw new CvRejectedError("notPdf");
  if (typeof asset.size === "number" && asset.size > CV_MAX_BYTES) {
    throw new CvRejectedError("tooLarge");
  }
  return { uri: asset.uri, name: asset.name };
}

export function uploadCv(
  cv: PickedCv,
  idempotencyKey: string = createIdempotencyKey(),
): Promise<NetworkingProfile> {
  const body = new FormData();
  // Expo fetch serializes File bytes; legacy React Native uri parts are unsupported.
  body.append(CV_FIELD_NAME, new File(cv.uri), cv.name);
  return apiFetch<NetworkingProfile>(CV_PATH, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body,
  });
}

export function deleteCv(
  idempotencyKey: string = createIdempotencyKey(),
): Promise<NetworkingProfile> {
  return apiFetch<NetworkingProfile>(CV_PATH, {
    method: "DELETE",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

/** The localized reason a CV change failed. */
export function cvErrorKey(cause: unknown, action: "upload" | "remove"): MessageKey {
  if (cause instanceof CvRejectedError) {
    return cause.reason === "tooLarge" ? "networkingCvTooLarge" : "networkingCvNotPdf";
  }
  if (cause instanceof ApiError) {
    if (cause.status === 413) return "networkingCvTooLarge";
    if (cause.status === 400) return "networkingCvNotPdf";
    if (cause.status === 409) return "networkingCvFromApplication";
  }
  return action === "upload" ? "networkingCvUploadError" : "networkingCvRemoveError";
}
