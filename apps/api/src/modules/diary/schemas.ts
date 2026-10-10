import { z } from "zod";

// #935: newlines and tabs are fine in a private note; other control characters are not.
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const hasForbiddenControl = (value: string) =>
  (value.match(CONTROL_CHARACTERS) ?? []).some((char) => char !== "\n" && char !== "\t");

const note = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length <= 500, { message: "Must be at most 500 characters" })
  .refine((value) => !hasForbiddenControl(value), {
    message: "Must not contain control characters",
  })
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const scanBody = z
  .object({
    code: z.string().trim().min(1).max(200),
  })
  .strict();

export const savePersonBody = z.object({ userId: z.number().int().positive() }).strict();

export const entryParams = z.object({ entryId: z.coerce.number().int().positive() });

export const updateEntryBody = z
  .object({ starred: z.boolean().optional(), note: note.optional() })
  .strict()
  .refine((body) => body.starred !== undefined || body.note !== undefined, {
    message: "Nothing to update",
  });
export type UpdateEntryInput = z.infer<typeof updateEntryBody>;
