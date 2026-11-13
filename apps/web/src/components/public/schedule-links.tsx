import Image from "next/image";
import { UserAvatar } from "@/components/common/user-avatar";
import type { PublicScheduleItem } from "@/lib/logistics";
import { cn } from "@/lib/utils";

/** Speakers' avatars and linked companies' logos of a schedule item (H48). */
export function ScheduleLinks({
  item,
  className,
}: {
  item: Pick<PublicScheduleItem, "speakers" | "enterprises">;
  className?: string;
}) {
  const speakers = item.speakers ?? [];
  const enterprises = item.enterprises ?? [];
  if (speakers.length === 0 && enterprises.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      {speakers.map((s) => (
        <li key={`u${s.userId}`} className="flex items-center gap-1.5 text-sm">
          <UserAvatar name={s.name} image={s.avatarUrl} className="size-6" decorative />
          <span>{s.name}</span>
        </li>
      ))}
      {enterprises.map((e) => (
        <li key={`e${e.id}`} className="flex items-center gap-1.5 text-sm">
          {e.logoUrl ? (
            // Company logo URLs are user-entered external URLs (H44), so they cannot be allowlisted.
            <Image
              src={e.logoUrl}
              alt=""
              width={48}
              height={24}
              unoptimized
              className="h-5 w-auto max-w-12 object-contain"
            />
          ) : null}
          <span>{e.name}</span>
        </li>
      ))}
    </ul>
  );
}
