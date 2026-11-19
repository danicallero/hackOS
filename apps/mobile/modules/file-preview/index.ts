import { NativeModule, requireOptionalNativeModule } from "expo";

declare class FilePreviewModule extends NativeModule<Record<string, never>> {
  /** iOS: Quick Look over the current screen; resolves when it closes. */
  preview(fileUri: string): Promise<void>;
  /** Android: the device's viewer for the type; false when none is installed. */
  open(contentUri: string, mimeType: string, title: string): Promise<boolean>;
}

/** null in Expo Go, on web and in development clients built before #935's viewer change. */
export default requireOptionalNativeModule<FilePreviewModule>("FilePreview");
