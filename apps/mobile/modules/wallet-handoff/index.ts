import { NativeModule, requireOptionalNativeModule } from "expo";

declare class WalletHandoffModule extends NativeModule<Record<string, never>> {
  openPkpass(contentUri: string, mimeTypes: string[], title: string): Promise<boolean>;
}

export default requireOptionalNativeModule<WalletHandoffModule>("WalletHandoff");
