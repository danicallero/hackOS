import { FileViewer } from "@/components/file-viewer";
import { cvFileName } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";

/**
 * In-app CV viewer (#935): the shared private-file viewer with the profile's
 * CV wording. A CV that is gone or no longer shared shows "not available".
 */
export function CvViewer({
  visible,
  title,
  cvPath,
  onClose,
}: {
  visible: boolean;
  /** The person's name. */
  title: string;
  /** Root-relative API route, e.g. `/api/directory/7/cv`. */
  cvPath: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  return (
    <FileViewer
      visible={visible}
      title={title}
      path={cvPath}
      fileName={cvFileName(title)}
      mimeType="application/pdf"
      onClose={onClose}
      errorMessage={t("directoryCvError")}
      missingTitle={t("directoryPersonNotFound")}
      shareLabel={t("directoryCvShare")}
      testID="cv-viewer"
    />
  );
}
