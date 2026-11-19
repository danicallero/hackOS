import { usePrivateFile } from "@/components/file-viewer";
import { cvFileName } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";

/**
 * Opens a CV (#935) through the shared private-file opener with the profile's
 * CV wording: the CV button shows `opening` while it downloads, then the PDF
 * opens. A CV that is gone or no longer shared shows "not available".
 */
export function useCvViewer() {
  const { t } = useLocale();
  const file = usePrivateFile({
    errorMessage: t("directoryCvError"),
    missingTitle: t("directoryPersonNotFound"),
    shareLabel: t("directoryCvShare"),
    testID: "cv-viewer",
  });
  return {
    /** `title` is the person's name; `cvPath` the root-relative CV route. */
    open: (title: string, cvPath: string) =>
      file.open({ path: cvPath, fileName: cvFileName(title), mimeType: "application/pdf", title }),
    opening: file.pending !== null,
    viewer: file.viewer,
  };
}
