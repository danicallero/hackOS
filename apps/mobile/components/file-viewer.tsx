import { Directory, File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { PixelRatio, Platform, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SheetModal } from "@/components/app-sheet";
import { EmptyState, FloatingGlassButton } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { getCurrentSessionCookie } from "@/lib/api";
import { apiAssetUrl } from "@/lib/directory";
import { editionHeaders } from "@/lib/edition";
import { useLocale } from "@/lib/i18n";
import filePreview, { type RenderedPdf } from "@/modules/file-preview";
import { colors } from "@/theme/colors";
import { CHROME_MAX_FONT_SIZE_MULTIPLIER, CHROME_MIN_FONT_SCALE } from "@/theme/dynamic-type";
import { type } from "@/theme/tokens";

/** A private API file to show: its route, the name it is saved and shared as, and its type. */
export interface PrivateFile {
  /** Root-relative API route. */
  path: string;
  fileName: string;
  mimeType: string;
  /** The viewer's title. */
  title: string;
}

type ViewerState =
  | { status: "loading" }
  | { status: "ready"; uri: string; pdf: RenderedPdf | null }
  | { status: "missing" }
  | { status: "error" };

const HEADER_HEIGHT = 76;
const PAGE_GAP = 12;

/** A cache file name that keeps the extension Quick Look and Share rely on. */
function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
}

/**
 * Downloads a private file with the session into its own cache directory, so
 * Quick Look and Share see the real file name. A route answering 404/403
 * means the file is gone or no longer visible.
 */
async function downloadPrivateFile(file: PrivateFile): Promise<ViewerState> {
  const url = apiAssetUrl(file.path);
  const headers = { Cookie: getCurrentSessionCookie(), ...editionHeaders() };
  try {
    const directory = new Directory(Paths.cache, "viewer");
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    const destination = new File(directory, safeFileName(file.fileName));
    if (destination.exists) destination.delete();
    const downloaded = await File.downloadFileAsync(url, destination, {
      headers,
      idempotent: true,
    });
    return { status: "ready", uri: downloaded.uri, pdf: null };
  } catch {
    // The download error does not carry the status; ask the route itself.
    const status = await fetch(url, { method: "HEAD", headers }).then(
      (response) => response.status,
      () => 0,
    );
    return { status: status === 404 || status === 403 ? "missing" : "error" };
  }
}

function deleteDirectory(uri: string | undefined) {
  if (!uri) return;
  try {
    const directory = new Directory(uri);
    if (directory.exists) directory.delete();
  } catch {
    // The system clears the cache eventually.
  }
}

/**
 * Opens private API files (#935, H16). The caller's button shows `pending`
 * while the file downloads with the session; then a PDF opens straight in
 * Quick Look on iOS, or as pages rendered by the system PdfRenderer in the
 * viewer sheet on Android. Photos fill the sheet with pinch zoom, anything
 * else (or a PDF no viewer can show) offers Share, and a failure opens the
 * sheet with the reason. The app bundles no PDF engine.
 */
export function usePrivateFile({
  errorMessage,
  missingTitle,
  shareLabel,
  testID = "file-viewer",
}: {
  errorMessage: string;
  missingTitle: string;
  shareLabel: string;
  testID?: string;
}): { open: (file: PrivateFile) => void; pending: string | null; viewer: ReactNode } {
  const { width } = useWindowDimensions();
  const [shown, setShown] = useState<{ file: PrivateFile; state: ViewerState } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const request = useRef(0);
  const pageDirectory = useRef<string | undefined>(undefined);

  const load = useCallback(
    async (file: PrivateFile, inSheet: boolean) => {
      const id = ++request.current;
      if (inSheet) setShown({ file, state: { status: "loading" } });
      else setPending(file.path);
      let state = await downloadPrivateFile(file);
      if (id !== request.current) return;
      const isPdf = file.mimeType === "application/pdf";
      if (state.status === "ready" && isPdf && filePreview) {
        if (Platform.OS === "ios") {
          setPending(null);
          setShown(null);
          try {
            await filePreview.preview(state.uri, file.title);
            return;
          } catch {
            // Falls through to the sheet's Share.
          }
        } else {
          try {
            const pdf = await filePreview.renderPdf(
              state.uri,
              Math.round(width * PixelRatio.get()),
            );
            if (id !== request.current) return deleteDirectory(pdf.directory);
            pageDirectory.current = pdf.directory;
            state = { ...state, pdf };
          } catch {
            // A PDF the renderer cannot read keeps Share.
          }
        }
      }
      if (id !== request.current) return;
      setPending(null);
      setShown({ file, state });
    },
    [width],
  );

  const open = useCallback(
    (file: PrivateFile) => {
      if (pending) return;
      void load(file, false);
    },
    [load, pending],
  );

  const close = useCallback(() => {
    request.current += 1;
    deleteDirectory(pageDirectory.current);
    pageDirectory.current = undefined;
    setShown(null);
  }, []);

  useEffect(() => () => deleteDirectory(pageDirectory.current), []);

  const viewer = shown ? (
    <FileViewerSheet
      file={shown.file}
      state={shown.state}
      onClose={close}
      onRetry={() => void load(shown.file, true)}
      errorMessage={errorMessage}
      missingTitle={missingTitle}
      shareLabel={shareLabel}
      testID={testID}
    />
  ) : null;
  return { open, pending, viewer };
}

function FileViewerSheet({
  file,
  state,
  onClose,
  onRetry,
  errorMessage,
  missingTitle,
  shareLabel,
  testID,
}: {
  file: PrivateFile;
  state: ViewerState;
  onClose: () => void;
  onRetry: () => void;
  errorMessage: string;
  missingTitle: string;
  shareLabel: string;
  testID: string;
}) {
  const { t } = useLocale();
  const { width } = useWindowDimensions();
  const [shareError, setShareError] = useState<Error | null>(null);
  const [sharing, setSharing] = useState(false);
  const isPdf = file.mimeType === "application/pdf";
  const isImage = file.mimeType.startsWith("image/");

  async function share() {
    if (sharing || state.status !== "ready") return;
    setSharing(true);
    setShareError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error(errorMessage);
      await Sharing.shareAsync(state.uri, {
        mimeType: file.mimeType,
        ...(isPdf ? { UTI: "com.adobe.pdf" } : {}),
        dialogTitle: file.title,
      });
    } catch (cause) {
      setShareError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setSharing(false);
    }
  }

  return (
    <SheetModal visible animationType="slide" onRequestClose={onClose}>
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
            {file.title}
          </Text>
        </View>
        {shareError ? (
          <RequestFeedback error={shareError} onRetry={() => void share()} retrying={sharing} />
        ) : null}
        <View style={{ flex: 1 }}>
          {state.status === "ready" && state.pdf ? (
            <ScrollView
              testID={`${testID}-pdf`}
              maximumZoomScale={4}
              minimumZoomScale={1}
              contentContainerStyle={{ gap: PAGE_GAP, paddingBottom: 32 }}
            >
              {state.pdf.pages.map((page, index) => (
                <Image
                  key={page.uri}
                  source={{ uri: page.uri }}
                  accessibilityLabel={`${file.title} ${index + 1}/${state.pdf?.pages.length}`}
                  contentFit="contain"
                  style={{ aspectRatio: page.width / page.height, width }}
                />
              ))}
            </ScrollView>
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
                accessibilityLabel={file.title}
                contentFit="contain"
                style={{ flex: 1, minHeight: 320 }}
              />
            </ScrollView>
          ) : state.status === "ready" ? (
            <EmptyState icon="doc" title={file.fileName} />
          ) : state.status === "missing" ? (
            <EmptyState icon="doc.text" title={missingTitle} />
          ) : state.status === "error" ? (
            <View style={{ padding: 16 }}>
              <RequestFeedback
                error={new Error("File download failed")}
                message={errorMessage}
                onRetry={onRetry}
              />
            </View>
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
