import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmptyState, FloatingGlassButton } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { getCurrentSessionCookie } from "@/lib/api";
import { apiAssetUrl } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

type ViewerState =
  | { status: "loading" }
  | { status: "ready"; uri: string }
  | { status: "missing" }
  | { status: "error" };

const HEADER_HEIGHT = 76;
type PdfComponent = typeof import("react-native-pdf")["default"];

/** A cache file name that keeps the extension Quick Look and Share rely on. */
export function cacheFileName(name: string) {
  return `viewer-${name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file"}`;
}

/**
 * In-app viewer for private API files (#935, H16). The route needs the
 * session, so the file is downloaded with the session cookie into the cache
 * and shown locally: photos fill the sheet with pinch zoom, PDFs scroll with
 * `react-native-pdf`, anything else offers Share. A file that is gone or no
 * longer visible answers 404/403 and shows `missingTitle`.
 */
export function FileViewer({
  visible,
  title,
  path,
  fileName,
  mimeType,
  onClose,
  errorMessage,
  missingTitle,
  shareLabel,
  testID = "file-viewer",
}: {
  visible: boolean;
  title: string;
  /** Root-relative API route. */
  path: string;
  fileName: string;
  mimeType: string;
  onClose: () => void;
  errorMessage: string;
  missingTitle: string;
  shareLabel: string;
  testID?: string;
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
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");

  const load = useCallback(async () => {
    const id = ++request.current;
    setState({ status: "loading" });
    const url = apiAssetUrl(path);
    const cookie = getCurrentSessionCookie();
    try {
      const destination = new File(Paths.cache, cacheFileName(fileName));
      if (destination.exists) destination.delete();
      const file = await File.downloadFileAsync(url, destination, {
        headers: { Cookie: cookie },
        idempotent: true,
      });
      if (id === request.current) setState({ status: "ready", uri: file.uri });
    } catch {
      // The download error does not carry the status; ask the route itself
      // whether the file is gone (404) or the request just failed.
      const status = await fetch(url, { method: "HEAD", headers: { Cookie: cookie } }).then(
        (response) => response.status,
        () => 0,
      );
      if (id === request.current) {
        setState({ status: status === 404 || status === 403 ? "missing" : "error" });
      }
    }
  }, [path, fileName]);

  useEffect(() => {
    if (visible) void load();
    else request.current += 1;
  }, [visible, load]);

  useEffect(() => {
    if (!visible || !isPdf) return;
    try {
      const module = require("react-native-pdf") as { default: PdfComponent };
      setPdf(() => module.default);
      setPdfReaderUnavailable(false);
    } catch {
      // Expo Go and stale development clients may not contain the native PDF
      // module. Keep routes usable and show the error only when it is opened.
      setPdfReaderUnavailable(true);
    }
  }, [visible, isPdf]);

  async function share() {
    if (state.status !== "ready" || !(await Sharing.isAvailableAsync())) return;
    await Sharing.shareAsync(state.uri, {
      mimeType,
      ...(isPdf ? { UTI: "com.adobe.pdf" } : {}),
      dialogTitle: title,
    });
  }

  const failure = (
    <View style={{ padding: 16 }}>
      <RequestFeedback
        error={new Error("File download failed")}
        message={errorMessage}
        onRetry={pdfReaderUnavailable ? undefined : () => void load()}
      />
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View testID={testID} style={{ backgroundColor: colors.background, flex: 1 }}>
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
          {isPdf && pdfReaderUnavailable ? (
            failure
          ) : state.status === "ready" && isPdf ? (
            Pdf ? (
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
            ) : (
              <RequestFeedback loading />
            )
          ) : state.status === "ready" && isImage ? (
            <ScrollView
              testID={`${testID}-image`}
              maximumZoomScale={4}
              minimumZoomScale={1}
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1 }}
            >
              <Image
                source={{ uri: state.uri }}
                accessibilityLabel={title}
                contentFit="contain"
                style={{ flex: 1, minHeight: 320 }}
              />
            </ScrollView>
          ) : state.status === "ready" ? (
            <EmptyState icon="doc" title={fileName} />
          ) : state.status === "missing" ? (
            <EmptyState icon="doc.text" title={missingTitle} />
          ) : state.status === "error" ? (
            failure
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
            accessibilityLabel={shareLabel}
            onPress={() => void share()}
          />
        ) : null}
      </View>
    </Modal>
  );
}
