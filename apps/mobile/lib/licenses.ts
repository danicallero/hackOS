import arvoLicense from "@/assets/fonts/arvo-license.json";
import licenses from "@/assets/licenses.json";

/** A third-party component in the shipped bundle. */
export interface LicenseEntry {
  name: string;
  version: string;
  /** SPDX license expression. */
  license: string;
  /** Browsable source repository, or null when the manifest names none. */
  source: string | null;
  /** The package's LICENSE/NOTICE file, or null when it ships none. */
  text: string | null;
}

export const LICENSES: readonly LicenseEntry[] = [...licenses, arvoLicense];

export function findLicense(name: string): LicenseEntry | undefined {
  return LICENSES.find((entry) => entry.name === name);
}
