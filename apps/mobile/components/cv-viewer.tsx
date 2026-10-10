import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmptyState, FloatingGlassButton } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { getCurrentSessionCookie } from "@/lib/api";
import { apiAssetUrl, cvFileName } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

type ViewerState =
  | { status: "loading" }
  | { status: "ready"; uri: string }
  | { status: "missing" }
  | { status: "error" };

const HEADER_HEIGHT = 76;
type PdfComponent = typeof import("react-native-pdf")["default"];

/**
 * In-app CV viewer (#935): the private CV route needs the session, so the PDF
 * is downloaded with the session cookie into the cache, then rendered locally
 * by `react-native-pdf` (scrolling pages, pinch and double-tap zoom). Share
 * stays in the header for anyone who wants the file. A CV that is gone or no
 * longer shared answers 404 and shows the profile's "not available" state.
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
  const insets = useSafeAreaInsets();
  // A pageSheet on iOS starts below the status bar; on Android the same
  // Modal is full screen, so its chrome clears the status bar itself.
  const sheetTopInset = process.env.EXPO_OS === "android" ? insets.top : 0;
  const [state, setState] = useState<ViewerState>({ status: "loading" });
  const [Pdf, setPdf] = useState<PdfComponent | null>(null);
  const [pdfReaderUnavailable, setPdfReaderUnavailable] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setState({ status: "loading" });
    const url = apiAssetUrl(cvPath);
    const cookie = getCurrentSessionCookie();
    try {
      const destination = new File(Paths.cache, cvFileName(title));
      if (destination.exists) destination.delete();
      const file = await File.downloadFileAsync(url, destination, {
        headers: { Cookie: cookie },
        idempotent: true,
      });
      if (id === request.current) setState({ status: "ready", uri: file.uri });
    } catch {
      // The download error does not carry the status; ask the route itself
      // whether the CV is gone (404) or the request just failed.
      const status = await fetch(url, { method: "HEAD", headers: { Cookie: cookie } }).then(
        (response) => response.status,
        () => 0,
      );
      if (id === request.current) {
        setState({ status: status === 404 || status === 403 ? "missing" : "error" });
      }
    }
  }, [cvPath, title]);

  useEffect(() => {
    if (visible) void load();
    else request.current += 1;
  }, [visible, load]);

  useEffect(() => {
    if (!visible) return;
    try {
      const module = require("react-native-pdf") as { default: PdfComponent };
      setPdf(() => module.default);
      setPdfReaderUnavailable(false);
    } catch {
      // Expo Go and stale development clients may not contain the native PDF
      // module. Keep profile routes usable and show the normal CV error only
      // when someone actually opens the viewer.
      setPdfReaderUnavailable(true);
    }
  }, [visible]);

  async function share() {
    if (state.status !== "ready" || !(await Sharing.isAvailableAsync())) return;
    await Sharing.shareAsync(state.uri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: title,
    });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View testID="cv-viewer" style={{ backgroundColor: colors.background, flex: 1 }}>
        <View
          style={{
            alignItems: "center",
            height: HEADER_HEIGHT + sheetTopInset,
            justifyContent: "center",
            paddingHorizontal: 72,
            paddingTop: sheetTopInset,
          }}
        >
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}
          >
            {title}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          {pdfReaderUnavailable ? (
            <View style={{ padding: 16 }}>
              <RequestFeedback
                error={new Error("PDF reader unavailable")}
                message={t("directoryCvError")}
              />
            </View>
          ) : state.status === "ready" && Pdf ? (
            <Pdf
              source={{ uri: state.uri }}
              trustAllCerts={false}
              enableDoubleTapZoom
              minScale={1}
              maxScale={4}
              spacing={12}
              fitPolicy={0}
              onError={() => setState({ status: "error" })}
              renderActivityIndicator={() => <ActivityIndicator color={colors.secondaryLabel} />}
              style={{ backgroundColor: colors.background, flex: 1 }}
            />
          ) : state.status === "missing" ? (
            <EmptyState icon="doc.text" title={t("directoryPersonNotFound")} />
          ) : state.status === "error" ? (
            <View style={{ padding: 16 }}>
              <RequestFeedback
                error={new Error("CV download failed")}
                message={t("directoryCvError")}
                onRetry={() => void load()}
              />
            </View>
          ) : (
            <RequestFeedback loading />
          )}
        </View>
        <FloatingGlassButton
          top={16 + sheetTopInset}
          side="left"
          icon="xmark"
          accessibilityLabel={t("close")}
          onPress={onClose}
        />
        {state.status === "ready" ? (
          <FloatingGlassButton
            top={16 + sheetTopInset}
            side="right"
            icon="square.and.arrow.up"
            accessibilityLabel={t("directoryCvShare")}
            onPress={() => void share()}
          />
        ) : null}
      </View>
    </Modal>
  );
}
