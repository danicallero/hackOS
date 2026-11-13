"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { apiAssetUrl } from "@/lib/directory";
import { initials } from "@/lib/initials";
import { cn } from "@/lib/utils";

/**
 * A person's account photo (#934). `image` is the authenticated
 * `/api/users/:id/photo` route the API returns; the object itself is never
 * public.
 *
 * `initials` is for surfaces whose purpose is the photo itself, such as the
 * photo editor. Text-first surfaces (the sidebar account row, user tables)
 * render this only when a photo exists and keep a plain placeholder disc while
 * it loads, so no avatar is fabricated (DESIGN.md §Navigation, §Lists).
 */
export function UserAvatar({
  name,
  image,
  className,
  fallbackClassName,
  decorative = false,
  showInitials = false,
  presenceLabel,
}: {
  name: string;
  image: string | null | undefined;
  className?: string;
  fallbackClassName?: string;
  /** Next to a visible name the photo adds nothing for screen readers. */
  decorative?: boolean;
  showInitials?: boolean;
  /** Current presence, announced by text and painted at the avatar edge. Omit when absent. */
  presenceLabel?: string;
}) {
  const avatar = (
    <Avatar className={className} aria-hidden={decorative || undefined}>
      {image ? <AvatarImage src={apiAssetUrl(image)} alt={decorative ? "" : name} /> : null}
      <AvatarFallback
        className={cn(
          showInitials ? "bg-[#007aff] font-medium text-white dark:bg-[#0a84ff]" : "bg-muted",
          fallbackClassName,
        )}
      >
        {showInitials ? initials(name) : null}
      </AvatarFallback>
    </Avatar>
  );
  return presenceLabel ? (
    <span className="relative inline-flex shrink-0">
      {avatar}
      <span className="absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background bg-success">
        <span className="sr-only">{presenceLabel}</span>
      </span>
    </span>
  ) : (
    avatar
  );
}
