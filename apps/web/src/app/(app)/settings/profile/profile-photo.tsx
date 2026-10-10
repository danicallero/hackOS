"use client";

import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { useId } from "react";
import { UserAvatar } from "@/components/common/user-avatar";
import { usePhotoUpload } from "@/components/profile/use-photo-upload";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

/**
 * The account photo (#934). It saves on its own, outside the personal-details
 * form: the API stores it privately and every surface reads it through the
 * authenticated photo route. The directory shows it only when the public
 * profile's photo switch is on.
 */
export function ProfilePhoto() {
  const { me, refresh } = useSessionContext();
  const { t } = useLocale();
  const hintId = useId();
  const { input, pick, remove, pending, error } = usePhotoUpload("/api/me/photo", refresh);
  if (!me) return null;

  const name = [me.name, me.surname].filter(Boolean).join(" ");
  return (
    <fieldset className="flex min-w-0 items-center gap-4">
      <legend className="sr-only">{t("profilePhoto")}</legend>
      <UserAvatar
        showInitials
        name={name}
        image={me.image}
        className="size-16"
        fallbackClassName="text-lg"
      />
      <div className="min-w-0 space-y-2">
        <input {...input} />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={pending === "upload"}
            disabled={pending !== null}
            aria-describedby={hintId}
            onClick={pick}
          >
            <UploadSimpleIcon aria-hidden="true" />
            {me.image ? t("changePhoto") : t("uploadPhoto")}
          </Button>
          {me.image && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={pending === "remove"}
              disabled={pending !== null}
              onClick={() => void remove()}
            >
              <TrashIcon aria-hidden="true" />
              {t("removePhoto")}
            </Button>
          )}
        </div>
        <p
          id={hintId}
          role={error ? "alert" : undefined}
          className={error ? "text-destructive text-sm" : "text-muted-foreground text-xs"}
        >
          {error ?? t("photoFileHint")}
        </p>
      </div>
    </fieldset>
  );
}
