import licenses from "@/assets/licenses.json";

/** One npm package in the shipped bundle (`scripts/generate-licenses.mjs`). */
export interface LicenseEntry {
  name: string;
  version: string;
  /** SPDX expression from the package manifest. */
  license: string;
  /** The package's LICENSE/NOTICE file, or null when it ships none. */
  text: string | null;
}

export const LICENSES: readonly LicenseEntry[] = licenses;

export function findLicense(name: string): LicenseEntry | undefined {
  return LICENSES.find((entry) => entry.name === name);
}
