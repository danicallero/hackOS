"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { CameraIcon } from "@phosphor-icons/react/dist/csr/Camera";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { Spinner } from "@/components/common/spinner";
import { usePhotoUpload } from "@/components/profile/use-photo-upload";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiAssetUrl } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { UserDetail } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fullName, initials } from "./shared";

const AVATAR = "size-14 ring-1 ring-border sm:size-16";

/**
 * The person's account photo in the user-detail header (#934). User staff
 * (`users:write`, H8) open a menu on the photo itself to upload, replace or
 * remove it; everyone else sees the photo only.
 */
export function UserPhoto({ user, onChanged }: { user: UserDetail; onChanged: () => unknown }) {
  const { t } = useLocale();
  const canWrite = useCan(CAPABILITIES.USERS_WRITE);
  const { input, pick, remove, pending } = usePhotoUpload(`/api/users/${user.id}/photo`, onChanged);

  const avatar = (
    <Avatar className={AVATAR}>
      {user.image && <AvatarImage src={apiAssetUrl(user.image)} alt={fullName(user)} />}
      <AvatarFallback className="text-lg">{initials(user)}</AvatarFallback>
    </Avatar>
  );
  if (!canWrite) return avatar;

  return (
    <>
      <input {...input} />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("profilePhoto")}
          disabled={pending !== null}
          className={cn(
            "group/photo relative block rounded-full outline-none",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-progress",
          )}
        >
          {avatar}
          <span
            aria-hidden="true"
            className="bg-foreground/0 absolute inset-0 rounded-full transition-colors group-hover/photo:bg-foreground/10 group-data-[state=open]/photo:bg-foreground/10"
          />
          <span
            aria-hidden="true"
            className="bg-background text-foreground border-border absolute -right-0.5 -bottom-0.5 flex size-6 items-center justify-center rounded-full border shadow-xs"
          >
            {pending ? <Spinner className="size-3.5" /> : <CameraIcon className="size-3.5" />}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={pick}>
            <UploadSimpleIcon aria-hidden="true" />
            {user.image ? t("changePhoto") : t("uploadPhoto")}
          </DropdownMenuItem>
          {user.image && (
            <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
              <TrashIcon aria-hidden="true" />
              {t("removePhoto")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
