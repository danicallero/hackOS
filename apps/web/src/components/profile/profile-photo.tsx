"use client";

import { CameraIcon } from "@phosphor-icons/react/dist/csr/Camera";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { Spinner } from "@/components/common/spinner";
import { UserAvatar } from "@/components/common/user-avatar";
import { usePhotoUpload } from "@/components/profile/use-photo-upload";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { cn } from "@/lib/utils";

const BADGE = cn(
  "bg-background text-foreground border-border absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full border shadow-xs outline-none",
  "hover:bg-muted focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  "disabled:cursor-progress disabled:opacity-70",
);

/**
 * The account photo (#934). It saves on its own, outside the personal-details
 * form: the API stores it privately and every surface reads it through the
 * authenticated photo route. People who scanned the owner see it only when
 * the public profile's photo switch is on. A camera button on the avatar
 * opens the file picker, or a change/remove menu once a photo exists.
 */
export function ProfilePhoto({ size = "md" }: { size?: "md" | "lg" } = {}) {
  const { me, refresh } = useSessionContext();
  const { t } = useLocale();
  const { input, pick, remove, pending, error } = usePhotoUpload("/api/me/photo", refresh);
  if (!me) return null;

  const name = [me.name, me.surname].filter(Boolean).join(" ");
  const icon = pending ? <Spinner className="size-4" /> : <CameraIcon className="size-4" />;
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="sr-only">{t("profilePhoto")}</legend>
      <input {...input} />
      <div className="relative w-fit">
        <UserAvatar
          showInitials
          name={name}
          image={me.image}
          className={size === "lg" ? "size-28" : "size-16"}
          fallbackClassName={size === "lg" ? "text-3xl" : "text-lg"}
        />
        {me.image ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("changePhoto")}
              disabled={pending !== null}
              className={BADGE}
            >
              {icon}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={pick}>
                <UploadSimpleIcon aria-hidden="true" />
                {t("changePhoto")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                <TrashIcon aria-hidden="true" />
                {t("removePhoto")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            type="button"
            aria-label={t("uploadPhoto")}
            disabled={pending !== null}
            onClick={pick}
            className={BADGE}
          >
            {icon}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </fieldset>
  );
}
