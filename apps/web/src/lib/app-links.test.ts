import { describe, expect, it } from "vitest";
import { assetLinks, certFingerprints } from "./app-links";

const FP = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase()).join(":");

describe("assetLinks (#935)", () => {
  it("lists no app without valid fingerprints", () => {
    expect(assetLinks(undefined)).toEqual([]);
    expect(assetLinks("not-a-fingerprint")).toEqual([]);
  });

  it("lists the release and debug packages with every valid fingerprint", () => {
    expect(certFingerprints(` ${FP.toLowerCase()} , bad`)).toEqual([FP]);
    const links = assetLinks(FP);
    expect(links.map((link) => link.target.package_name)).toEqual([
      "com.hackudc.os",
      "com.hackudc.os.debug",
    ]);
    expect(links[0]).toMatchObject({
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", sha256_cert_fingerprints: [FP] },
    });
  });
});
