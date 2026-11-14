"use client";

import { useRef, useState } from "react";
import { api, apiUpload } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { compressPhoto, PICKABLE_PHOTO_TYPES, UnsupportedPhotoError } from "@/lib/compress-image";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";

/**
 * Upload and removal of an account photo (#934) against `endpoint`: the
 * caller's own `/api/me/photo`, or `/api/users/:id/photo` for user staff (H8).
 * The hidden file input is driven through `inputRef`; `onChanged` reloads
 * whatever shows the photo once the API has stored or cleared it. The photo
 * is compressed in the browser to the 5 MB cap first; only formats it cannot
 * read as an image are refused.
 */
export function usePhotoUpload(endpoint: string, onChanged: () => unknown) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function fail(message: string, title: string) {
    setError(message);
    toast.error(message, title);
  }

  async function upload(file: File) {
    setError(null);
    setPending("upload");
    try {
      const body = new FormData();
      body.append("file", await compressPhoto(file));
      await apiUpload(endpoint, body);
      await onChanged();
      toast.success(t("photoUpdated"), { compactTitle: t("toastUploadPhoto") });
    } catch (err) {
      fail(
        err instanceof UnsupportedPhotoError
          ? t("photoFileHint")
          : apiErrorText(err, t, t("couldNotUploadPhoto")),
        t("toastUploadPhoto"),
      );
    } finally {
      setPending(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setError(null);
    setPending("remove");
    try {
      await api.delete(endpoint);
      await onChanged();
      toast.success(t("photoRemoved"), { compactTitle: t("toastRemovePhoto") });
    } catch (err) {
      fail(apiErrorText(err, t, t("couldNotRemovePhoto")), t("toastRemovePhoto"));
    } finally {
      setPending(null);
    }
  }

  const input = {
    ref: inputRef,
    type: "file" as const,
    accept: PICKABLE_PHOTO_TYPES.join(","),
    className: "sr-only",
    tabIndex: -1,
    "aria-hidden": true as const,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void upload(file);
    },
  };

  return { input, pick: () => inputRef.current?.click(), remove, pending, error };
}
