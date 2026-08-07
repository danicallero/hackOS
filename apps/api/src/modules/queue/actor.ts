import { UnauthorizedError } from "../../lib/errors.js";

export function actor(userId: number | null): number {
  if (userId == null) throw new UnauthorizedError();
  return userId;
}
