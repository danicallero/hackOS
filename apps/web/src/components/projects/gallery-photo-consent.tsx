"use client";
import { useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";

/** H18: consent to public gallery photos is separate from scan-profile sharing. */
export function GalleryPhotoConsent() {
  const { t } = useLocale();
  const [showPhoto, setShowPhoto] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api
      .get<{ showPhoto: boolean }>("/api/me/project-gallery-consent")
      .then((value) => {
        if (active) setShowPhoto(value.showPhoto);
      })
      .catch((cause) => {
        if (active) setError(apiErrorText(cause, t, t("couldNotLoadProject")));
      });
    return () => {
      active = false;
    };
  }, [t]);
  async function save(value: boolean) {
    setPending(true);
    setError(null);
    try {
      const saved = await api.put<{ showPhoto: boolean }>("/api/me/project-gallery-consent", {
        showName: true,
        showPhoto: value,
      });
      setShowPhoto(saved.showPhoto);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveProfile")));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mt-4 space-y-2 border-t border-border/60 pt-4">
      <div className="flex items-start gap-2">
        <Checkbox
          id="gallery-photo-consent"
          checked={showPhoto ?? false}
          disabled={pending || showPhoto === null}
          onCheckedChange={(value) => void save(value === true)}
          aria-describedby="gallery-photo-policy"
        />
        <Label htmlFor="gallery-photo-consent">{t("projectGalleryPhotoConsent")}</Label>
      </div>
      <p className="text-sm text-muted-foreground text-pretty" id="gallery-photo-policy">
        {t("projectGalleryPhotoNotice")}
      </p>
      {error && <ContextualError message={error} />}
    </div>
  );
}
