import { NativeModule, requireOptionalNativeModule } from "expo";

export type HardwareShortcut = { id: string; input: string };

type HardwareShortcutsEvents = {
  onShortcut: (event: { id: string }) => void;
};

declare class HardwareShortcutsModule extends NativeModule<HardwareShortcutsEvents> {
  /** Command + `input` triggers `onShortcut` with `id`. Replaces the previous set. */
  setShortcuts(items: HardwareShortcut[]): void;
}

/** Missing on Android and on a development client built before the module existed. */
export default requireOptionalNativeModule<HardwareShortcutsModule>("HardwareShortcuts");
