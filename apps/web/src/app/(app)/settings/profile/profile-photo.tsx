"use client";

import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { useId, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ApiError, api, apiUpload } from "@/lib/api";
import { apiAssetUrl } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";

const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The account photo (#934). It saves on its own, outside the personal-details
 * form: the API stores it privately and every surface reads it through the
 * authenticated photo route. The directory shows it only when the public
 * profile's photo switch is on.
 */
export function ProfilePhoto() {
  const { me, refresh } = useSessionContext();
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [pending, setPending] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;

  function fail(message: string, title: string) {
    setError(message);
    toast.error(message, title);
  }

  async function upload(file: File) {
    setError(null);
    if (!PHOTO_TYPES.includes(file.type) || file.size > PHOTO_MAX_BYTES) {
      fail(t("photoFileHint"), t("toastUploadPhoto"));
      return;
    }
    setPending("upload");
    try {
      const body = new FormData();
      body.append("file", file);
      await apiUpload("/api/me/photo", body);
      await refresh();
      toast.success(t("photoUpdated"), { compactTitle: t("toastUploadPhoto") });
    } catch (err) {
      fail(err instanceof ApiError ? err.message : t("couldNotUploadPhoto"), t("toastUploadPhoto"));
    } finally {
      setPending(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setError(null);
    setPending("remove");
    try {
      await api.delete("/api/me/photo");
      await refresh();
      toast.success(t("photoRemoved"), { compactTitle: t("toastRemovePhoto") });
    } catch (err) {
      fail(err instanceof ApiError ? err.message : t("couldNotRemovePhoto"), t("toastRemovePhoto"));
    } finally {
      setPending(null);
    }
  }

  const name = [me.name, me.surname].filter(Boolean).join(" ");
  return (
    <fieldset className="flex min-w-0 items-center gap-4">
      <legend className="sr-only">{t("profilePhoto")}</legend>
      <Avatar className="size-16 text-lg">
        {me.image && <AvatarImage src={apiAssetUrl(me.image)} alt={name} />}
        <AvatarFallback className="text-lg">{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 space-y-2">
        <input
          ref={inputRef}
          type="file"
          accept={PHOTO_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={pending === "upload"}
            disabled={pending !== null}
            aria-describedby={hintId}
            onClick={() => inputRef.current?.click()}
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
              onClick={remove}
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
