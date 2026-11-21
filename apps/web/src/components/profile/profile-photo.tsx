"use client";

import { CameraIcon } from "@phosphor-icons/react/dist/csr/Camera";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { Spinner } from "@/components/common/spinner";
import { UserAvatar } from "@/components/common/user-avatar";
import { usePhotoUpload } from "@/components/profile/use-photo-upload";
import { buttonVariants } from "@/components/ui/button";
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
 * the public profile's photo switch is on. A camera control on the avatar
 * opens the file picker, or a change/remove menu once a photo exists.
 */
export function ProfilePhoto({
  size = "md",
  variant = "avatar",
}: {
  size?: "md" | "lg";
  variant?: "avatar" | "button";
} = {}) {
  const { me, refresh } = useSessionContext();
  const { t } = useLocale();
  const { input, pick, remove, pending, error } = usePhotoUpload("/api/me/photo", refresh);
  if (!me) return null;

  const triggerClass = variant === "button" ? buttonVariants({ variant: "outline" }) : BADGE;
  const label = me.image ? t("changePhoto") : t("uploadPhoto");
  const name = [me.name, me.surname].filter(Boolean).join(" ");
  const icon = pending ? <Spinner className="size-4" /> : <CameraIcon className="size-4" />;
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="sr-only">{t("profilePhoto")}</legend>
      {me.image ? <input {...input} /> : null}
      <div className="relative w-fit">
        {variant === "avatar" ? (
          <UserAvatar
            userId={me.id}
            name={name}
            image={me.image}
            className={size === "lg" ? "size-28" : "size-16"}
          />
        ) : null}
        {me.image ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("changePhoto")}
              disabled={pending !== null}
              className={triggerClass}
            >
              {icon}
              {variant === "button" ? label : null}
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
          // A label around the file input, not a button calling `input.click()`: the
          // tap opens the picker natively, which iOS browsers honor where a scripted
          // click on the hidden input was reported to do nothing (H15 share step).
          <label
            className={cn(
              triggerClass,
              "cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
              pending !== null && "cursor-progress opacity-70",
            )}
          >
            <input
              ref={input.ref}
              type="file"
              accept={input.accept}
              onChange={input.onChange}
              className="sr-only"
              aria-label={t("uploadPhoto")}
              disabled={pending !== null}
            />
            {icon}
            {variant === "button" ? label : null}
          </label>
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
