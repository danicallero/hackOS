import { File } from "expo-file-system";
import { ImageManipulator, type ImageRef, SaveFormat } from "expo-image-manipulator";

/** Upload cap for every photo, matching the API's photo limits. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const QUALITIES = [0.8, 0.65, 0.5];
const SCALE_STEP = 0.75;
const MIN_EDGE = 320;

/**
 * Save a rendered photo as JPEG at or under `maxBytes` (#934, H16): quality
 * drops first, then dimensions, so a photo is shrunk on the device instead of
 * refused. Returns the saved file's URI; if even the smallest attempt does not
 * fit, that attempt is returned and the caller's size check reports it.
 */
export async function savePhotoWithin(
  image: ImageRef,
  maxBytes: number = PHOTO_MAX_BYTES,
): Promise<string> {
  let current = image;
  let uri = "";
  while (true) {
    for (const compress of QUALITIES) {
      uri = (await current.saveAsync({ compress, format: SaveFormat.JPEG })).uri;
      const size = new File(uri).size;
      if (!size || size <= maxBytes) return uri;
    }
    const width = Math.round(current.width * SCALE_STEP);
    const height = Math.round(current.height * SCALE_STEP);
    if (Math.min(width, height) < MIN_EDGE) return uri;
    current = await ImageManipulator.manipulate(uri).resize({ width, height }).renderAsync();
  }
}

/** Compress a picked image file (any format the device decodes) to the cap. */
export async function compressPhotoFile(uri: string, maxBytes = PHOTO_MAX_BYTES): Promise<string> {
  return savePhotoWithin(await ImageManipulator.manipulate(uri).renderAsync(), maxBytes);
}
