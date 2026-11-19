import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { AppActivityIndicator } from "@/components/app-activity-indicator";
import { SheetModal } from "@/components/app-sheet";
import { EmptyState, FloatingGlassButton } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { getCurrentSessionCookie } from "@/lib/api";
import { apiAssetUrl } from "@/lib/directory";
import { editionHeaders } from "@/lib/edition";
import { useLocale } from "@/lib/i18n";
import filePreview from "@/modules/file-preview";
import { colors } from "@/theme/colors";
import { CHROME_MAX_FONT_SIZE_MULTIPLIER, CHROME_MIN_FONT_SCALE } from "@/theme/dynamic-type";
import { type } from "@/theme/tokens";

type ViewerState =
  | { status: "loading" }
  | { status: "ready"; uri: string }
  | { status: "missing" }
  | { status: "error" };

const HEADER_HEIGHT = 76;

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
  const [state, setState] = useState<ViewerState>({ status: "loading" });
  const [shareError, setShareError] = useState<Error | null>(null);
  const [sharing, setSharing] = useState(false);
  const request = useRef(0);
  const previewed = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");

  const load = useCallback(async () => {
    const id = ++request.current;
    previewed.current = null;
    setState({ status: "loading" });
    const url = apiAssetUrl(path);
    const cookie = getCurrentSessionCookie();
    try {
      const destination = new File(Paths.cache, cacheFileName(fileName));
      if (destination.exists) destination.delete();
      const file = await File.downloadFileAsync(url, destination, {
        headers: { Cookie: cookie, ...editionHeaders() },
        idempotent: true,
      });
      if (id === request.current) setState({ status: "ready", uri: file.uri });
    } catch {
      // The download error does not carry the status; ask the route itself
      // whether the file is gone (404) or the request just failed.
      const status = await fetch(url, {
        method: "HEAD",
        headers: { Cookie: cookie, ...editionHeaders() },
      }).then(
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

  // A downloaded PDF goes to the system viewer once; the sheet stays behind it
  // as the fallback (file name and Share) if no viewer can open it.
  useEffect(() => {
    if (!isPdf || state.status !== "ready" || !filePreview) return;
    if (previewed.current === state.uri) return;
    previewed.current = state.uri;
    const uri = state.uri;
    const shown =
      Platform.OS === "ios"
        ? filePreview.preview(uri).then(() => true)
        : filePreview.open(new File(uri).contentUri, mimeType, title);
    shown.then(
      (closed) => {
        if (closed) onCloseRef.current();
      },
      () => {
        // The Share fallback stays on screen.
      },
    );
  }, [isPdf, state, mimeType, title]);

  async function share() {
    if (sharing || state.status !== "ready") return;
    setSharing(true);
    setShareError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error(errorMessage);
      await Sharing.shareAsync(state.uri, {
        mimeType,
        ...(isPdf ? { UTI: "com.adobe.pdf" } : {}),
        dialogTitle: title,
      });
    } catch (cause) {
      setShareError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setSharing(false);
    }
  }

  const failure = (
    <View style={{ padding: 16 }}>
      <RequestFeedback
        error={new Error("File download failed")}
        message={errorMessage}
        onRetry={() => void load()}
      />
    </View>
  );

  return (
    <SheetModal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View testID={testID} style={{ backgroundColor: colors.background, flex: 1 }}>
        <View
          style={{
            alignItems: "center",
            height: HEADER_HEIGHT,
            justifyContent: "center",
            paddingHorizontal: 72,
          }}
        >
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
            adjustsFontSizeToFit
            minimumFontScale={CHROME_MIN_FONT_SCALE}
            style={{ color: colors.label, fontSize: type.body.fontSize, fontWeight: "600" }}
          >
            {title}
          </Text>
        </View>
        {shareError ? (
          <RequestFeedback error={shareError} onRetry={() => void share()} retrying={sharing} />
        ) : null}
        <View style={{ flex: 1 }}>
          {state.status === "ready" && isImage ? (
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
          top={16}
          side="left"
          icon="xmark"
          accessibilityLabel={t("close")}
          onPress={onClose}
        />
        {state.status === "ready" ? (
          <FloatingGlassButton
            top={16}
            side="right"
            icon="square.and.arrow.up"
            accessibilityLabel={shareLabel}
            onPress={() => void share()}
          />
        ) : null}
      </View>
    </SheetModal>
  );
}
