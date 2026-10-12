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
}: {
  name: string;
  image: string | null | undefined;
  className?: string;
  fallbackClassName?: string;
  /** Next to a visible name the photo adds nothing for screen readers. */
  decorative?: boolean;
  showInitials?: boolean;
}) {
  return (
    <Avatar className={className} aria-hidden={decorative || undefined}>
      {image ? <AvatarImage src={apiAssetUrl(image)} alt={decorative ? "" : name} /> : null}
      <AvatarFallback
        className={cn(
          showInitials ? "bg-primary/10 font-medium text-primary" : "bg-muted",
          fallbackClassName,
        )}
      >
        {showInitials ? initials(name) : null}
      </AvatarFallback>
    </Avatar>
  );
}
