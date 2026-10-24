import { createHash } from "node:crypto";
import webEn from "../../packages/shared/locales/en/web.json" with { type: "json" };
import { expect, test } from "./fixtures";

// #1083: the public verification page keeps the document visible on narrow screens
// and checks a downloaded PDF against the stored copies without uploading it.
const pdf = Buffer.from("%PDF-1.7 fixture");
const fingerprint = createHash("sha256").update(pdf).digest("hex");
const code = "abcdefghijklmnopqrstuvwx";
const verification = {
  status: "valid",
  variant: "participation",
  issuedAt: "2026-10-24T12:00:00Z",
  issuerName: "GPUL",
  name: "Ada",
  surname: "Lovelace",
  eventName: "HackUDC",
  eventStartsAt: null,
  eventEndsAt: null,
  hours: null,
  sha256: fingerprint,
  generatedAt: "2026-10-24T12:00:00Z",
  supersededAt: null,
};

test.use({ viewport: { width: 390, height: 800 }, locale: "en-US" });

test("shows the fingerprint without crushing the document and checks a PDF", async ({ page }) => {
  const lookups: string[] = [];
  await page.route("**/api/public/certificates/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/pdf"))
      return route.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
    if (path.includes("/by-hash/")) {
      const hash = path.split("/").pop() as string;
      lookups.push(hash);
      return hash === fingerprint
        ? route.fulfill({ json: { ...verification, code } })
        : route.fulfill({ status: 404, json: { error: { code: "not_found", message: "none" } } });
    }
    return route.fulfill({ json: verification });
  });
  await page.goto(`/verify/${code}`);
  await page.getByRole("button", { name: /dismiss cookie notice/i }).click();
  const toggle = page.getByRole("button", { name: "SHA-256" });
  await expect(toggle).toBeVisible();
  await expect(page.getByText(fingerprint, { exact: true })).toHaveCount(0);
  const frame = await page.locator("iframe").boundingBox();
  expect(frame?.height).toBeGreaterThan(500);
  await expect(page.getByRole("link", { name: webEn.certificateDownload })).toHaveAttribute(
    "href",
    /\/pdf\?download=1$/,
  );
  await page.screenshot({
    path: `artifacts/settings/certificate-verify-collapsed-${test.info().project.name}.png`,
    animations: "disabled",
  });
  await toggle.click();
  await page.screenshot({
    path: `artifacts/settings/certificate-verify-expanded-${test.info().project.name}.png`,
    animations: "disabled",
  });
  const hash = page.getByText(fingerprint, { exact: true });
  await expect(hash).toBeVisible();
  expect((await hash.boundingBox())?.height).toBeLessThan(80);
  const chooser = page.locator('input[type="file"]');
  await chooser.setInputFiles({
    name: "certificate.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(page.getByText(webEn.certificateFileMatches)).toBeVisible();
  await chooser.setInputFiles({
    name: "other.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 tampered"),
  });
  await expect(page.getByText(webEn.certificateFileUnknown)).toBeVisible();
  expect(lookups).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("finds the certificate a PDF belongs to from the verification root", async ({ page }) => {
  await page.route("**/api/public/certificates/by-hash/**", (route) =>
    route.fulfill({ json: { ...verification, code } }),
  );
  await page.goto("/verify");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "certificate.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText(webEn.certificateFileFound)).toBeVisible();
  await expect(page.getByRole("link", { name: webEn.certificateVerifyTitle })).toHaveAttribute(
    "href",
    `/verify/${code}`,
  );
});
