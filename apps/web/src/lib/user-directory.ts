import { api } from "./api";
import type { UserList, UserListItem } from "./types";

/** H8/H10: directory consumers must not truncate membership or local filters at one API page. */
export async function loadUserDirectory(signal?: AbortSignal, q?: string): Promise<UserList> {
  const users = new Map<number, UserListItem>();
  let offset = 0;
  let total: number;
  do {
    const page = await api.get<UserList>("/api/users", {
      query: { q: q || undefined, limit: 200, offset },
      signal,
    });
    total = page.total;
    for (const user of page.users) users.set(user.id, user);
    offset += page.users.length;
    if (page.users.length === 0) break;
  } while (offset < total);
  return { users: [...users.values()], total };
}
