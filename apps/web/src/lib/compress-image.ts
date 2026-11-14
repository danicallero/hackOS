/**
 * Client-side photo compression (#934, H16): every photo leaves the browser at
 * or under the upload cap, so a large camera photo is shrunk instead of
 * refused. Files already within the cap in a stored format pass through
 * untouched; anything else is decoded and re-encoded (JPEG by default),
 * lowering quality and then dimensions until it fits. Formats the browser
 * decodes but the API does not store (HEIC, AVIF) are converted the same way.
 */

/** Upload cap for every photo, matching the API's photo limits. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Formats the API stores as photos (sniffed server-side). */
export const STORED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Formats a picker offers: the stored ones plus common camera formats converted on device. */
export const PICKABLE_PHOTO_TYPES = [
  ...STORED_PHOTO_TYPES,
  "image/heic",
  "image/heif",
  "image/avif",
];

export class UnsupportedPhotoError extends Error {}

const QUALITIES = [0.9, 0.82, 0.72, 0.6];
const SCALE_STEP = 0.75;
const MIN_EDGE = 320;

export async function compressPhoto(
  file: File,
  {
    maxBytes = PHOTO_MAX_BYTES,
    output = "image/jpeg",
  }: { maxBytes?: number; output?: "image/jpeg" | "image/png" | "image/webp" } = {},
): Promise<File> {
  if (STORED_PHOTO_TYPES.includes(file.type) && file.size <= maxBytes) return file;
  if (!PICKABLE_PHOTO_TYPES.includes(file.type) && !/\.(heic|heif|avif)$/i.test(file.name)) {
    throw new UnsupportedPhotoError(file.type || file.name);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new UnsupportedPhotoError(file.type || file.name);
  }
  try {
    let width = bitmap.width;
    let height = bitmap.height;
    while (true) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new UnsupportedPhotoError(file.type);
      if (output === "image/jpeg") {
        // JPEG has no alpha: transparent areas become white instead of black.
        context.fillStyle = "#fff";
        context.fillRect(0, 0, width, height);
      }
      context.drawImage(bitmap, 0, 0, width, height);
      const qualities = output === "image/png" ? [undefined] : QUALITIES;
      for (const quality of qualities) {
        const blob = await encode(canvas, output, quality);
        if (blob.size <= maxBytes) return asFile(blob, file.name);
      }
      if (Math.min(width, height) * SCALE_STEP < MIN_EDGE) {
        throw new UnsupportedPhotoError(file.type);
      }
      width = Math.round(width * SCALE_STEP);
      height = Math.round(height * SCALE_STEP);
    }
  } finally {
    bitmap.close();
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new UnsupportedPhotoError(type))),
      type,
      quality,
    ),
  );
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Keep the original name, with the extension of the format actually produced. */
function asFile(blob: Blob, name: string): File {
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${base}.${EXTENSIONS[blob.type] ?? "jpg"}`, { type: blob.type });
}
