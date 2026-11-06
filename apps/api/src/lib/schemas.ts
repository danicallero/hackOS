import { z } from "zod";

/** Positive integer from a path/query string, the shape of every numeric row id. */
export const positiveInt = z.coerce.number().int().positive();

/** `:id` route params. */
export const idParams = z.object({ id: positiveInt });

/** Route params for one named id, e.g. `idParam("roomId")`. */
export function idParam<K extends string>(name: K) {
  return z.object({ [name]: positiveInt } as Record<K, typeof positiveInt>);
}
