import { NativeModule, requireOptionalNativeModule } from "expo";

export interface RenderedPdf {
  /** Cache directory holding the pages; delete it when the viewer closes. */
  directory: string;
  pages: { uri: string; width: number; height: number }[];
}

declare class FilePreviewModule extends NativeModule<Record<string, never>> {
  /** iOS: Quick Look over the current screen, titled `title`; resolves when it closes. */
  preview(fileUri: string, title: string): Promise<void>;
  /** Android: the PDF's pages as JPEGs `widthPx` wide, via the platform PdfRenderer. */
  renderPdf(fileUri: string, widthPx: number): Promise<RenderedPdf>;
}

/** null in Expo Go, on web and in development clients built before #935's viewer change. */
export default requireOptionalNativeModule<FilePreviewModule>("FilePreview");
