// Android App Links statements for /.well-known/assetlinks.json (#935).

/** Release and debug packages, as in apps/mobile/app.json and app.config.ts. */
const PACKAGES = ["com.hackudc.os", "com.hackudc.os.debug"];

/** Comma-separated SHA-256 certificate fingerprints; malformed entries are dropped. */
export function certFingerprints(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(item));
}

/** Without fingerprints no app is listed, and company-tag links open the web page. */
export function assetLinks(fingerprintsEnv: string | undefined) {
  const certs = certFingerprints(fingerprintsEnv);
  if (certs.length === 0) return [];
  return PACKAGES.map((packageName) => ({
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: packageName,
      sha256_cert_fingerprints: certs,
    },
  }));
}
