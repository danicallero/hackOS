"use client";

import { mascotAvatarChoice } from "@hackos/shared/mascot-avatars";
import Image from "next/image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { apiAssetUrl } from "@/lib/directory";
import { mascotAvatarUrl } from "@/lib/mascot-avatar";

/**
 * A person's account photo (#934). `image` is the authenticated
 * `/api/users/:id/photo` route the API returns; the object itself is never
 * public.
 *
 * Without a photo, during loading or after a failed load, the shared deterministic
 * mascot and independent background color represent the same person everywhere.
 */
export function UserAvatar({
  name,
  userId,
  image,
  className,
  style,
  decorative = false,
  presenceLabel,
}: {
  name: string;
  userId?: string | number;
  image: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
  /** Next to a visible name the photo adds nothing for screen readers. */
  decorative?: boolean;
  /** Current presence, announced by text and painted at the avatar edge. Omit when absent. */
  presenceLabel?: string;
}) {
  const fallback = mascotAvatarChoice(userId, name);
  const avatar = (
    <Avatar
      className={className}
      style={style}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : name}
    >
      {image ? <AvatarImage src={apiAssetUrl(image)} alt={decorative ? "" : name} /> : null}
      <AvatarFallback className="overflow-hidden" style={{ backgroundColor: fallback.background }}>
        <Image
          src={mascotAvatarUrl(userId, name)}
          width={384}
          height={384}
          unoptimized
          alt=""
          className="size-full object-cover"
        />
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
