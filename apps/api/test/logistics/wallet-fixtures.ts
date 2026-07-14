/**
 * MUST be imported (after ./env.js) by any test that exercises Apple/Google
 * wallet signing, BEFORE any app code (config.ts parses env at import time).
 * Not part of the shared logistics env.ts — most logistics tests never touch
 * wallet code and shouldn't pay for shelling out to openssl on every run.
 *
 * Generates a real self-signed cert/key pair (openssl — expected on any
 * dev/CI machine, distinct from the runtime container image, which is a
 * separate concern covered by the Dockerfile) and a real RSA keypair for
 * Google's JWT signing, so tests exercise the actual signing code paths
 * instead of a mocked/empty one.
 */
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "hackos-wallet-fixtures-"));
const certPath = join(dir, "cert.pem");
const keyPath = join(dir, "key.pem");

execFileSync("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  keyPath,
  "-out",
  certPath,
  "-days",
  "1",
  "-subj",
  "/CN=hackOS Test",
]);

export const testCertPem = readFileSync(certPath, "utf8");
export const testKeyPem = readFileSync(keyPath, "utf8");

rmSync(dir, { recursive: true, force: true });

process.env.APPLE_PASS_TYPE_IDENTIFIER = "pass.test.hackos";
process.env.APPLE_TEAM_IDENTIFIER = "TESTTEAM";
process.env.APPLE_PASS_CERTIFICATE_PEM = Buffer.from(testCertPem).toString("base64");
process.env.APPLE_PASS_KEY_PEM = Buffer.from(testKeyPem).toString("base64");
// openssl smime -sign doesn't validate that -certfile actually issued
// -signer at signing time (only at verify time), so reusing the same
// self-signed cert as a stand-in "WWDR" is enough to exercise the real
// signing path without needing Apple's real intermediate.
process.env.APPLE_WWDR_CERTIFICATE_PEM = Buffer.from(testCertPem).toString("base64");
// Env vars are strings — exercises the zod coercion to a numeric Adam ID.
process.env.APPLE_PASS_APP_STORE_ID = "1234567890";

const { privateKey: googlePrivateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
export const testGooglePrivateKeyPem = googlePrivateKey;

process.env.GOOGLE_WALLET_ISSUER_ID = "3388000000022222222";
process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL = "test@hackos-test.iam.gserviceaccount.com";
process.env.GOOGLE_WALLET_PRIVATE_KEY_PEM = Buffer.from(testGooglePrivateKeyPem).toString("base64");
