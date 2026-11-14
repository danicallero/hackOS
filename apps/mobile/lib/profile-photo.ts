import { File } from "expo-file-system";
import { ImageManipulator } from "expo-image-manipulator";
import { apiFetch } from "./api";
import { savePhotoWithin } from "./compress-photo";
import { createIdempotencyKey } from "./idempotency-key";

/**
 * The account photo (#934), as POST/DELETE /api/me/photo: PNG, JPEG or WebP up
 * to 5 MB. The device always sends a square JPEG well under that cap.
 */
export const PHOTO_EDGE = 1024;
export const PHOTO_FIELD_NAME = "file";

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

/** Centred square crop, then at most PHOTO_EDGE px per side, as JPEG. */
export async function preparePhoto(picked: PickedPhoto): Promise<string> {
  const side = Math.min(picked.width, picked.height);
  let context = ImageManipulator.manipulate(picked.uri).crop({
    originX: Math.floor((picked.width - side) / 2),
    originY: Math.floor((picked.height - side) / 2),
    width: side,
    height: side,
  });
  if (side > PHOTO_EDGE) context = context.resize({ width: PHOTO_EDGE });
  return savePhotoWithin(await context.renderAsync());
}

/** The API replaces the stored photo and answers its new `?v=` route. */
export function uploadPhoto(
  uri: string,
  idempotencyKey: string = createIdempotencyKey(),
): Promise<{ image: string | null }> {
  const body = new FormData();
  // Expo fetch serializes File bytes; legacy React Native uri parts are unsupported.
  body.append(PHOTO_FIELD_NAME, new File(uri), "photo.jpg");
  return apiFetch<{ image: string | null }>("/api/me/photo", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body,
  });
}

export function deletePhoto(
  idempotencyKey: string = createIdempotencyKey(),
): Promise<{ image: string | null }> {
  return apiFetch<{ image: string | null }>("/api/me/photo", {
    method: "DELETE",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}
