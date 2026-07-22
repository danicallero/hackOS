import { connect } from "node:http2";
import { config } from "../../config.js";

/**
 * APNs push for pass updates (H28: "se empuja la actualización cuando
 * cambia mi estado"). Apple ties push authorization for a Pass Type ID to
 * that identifier's own certificate, so this reuses the same cert/key pair
 * `wallet.ts` signs manifests with — mutual TLS via node:http2, no separate
 * push certificate and no new dependency.
 */

const APNS_HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;

/** Thrown when APNs reports the token as gone (410) — caller should stop tracking the device. */
export class ApplePushUnregisteredError extends Error {}

function decodePem(base64: string): string {
  return Buffer.from(base64, "base64").toString("utf8");
}

/** No-ops when Apple Wallet isn't configured — badge rotation must never fail on this. */
export async function sendApplePush(pushToken: string, passTypeIdentifier: string): Promise<void> {
  if (!config.appleWalletConfigured) {
    console.warn("wallet: skipping APNs push, Apple Wallet is not configured");
    return;
  }

  const cert = `${decodePem(config.APPLE_PASS_CERTIFICATE_PEM!)}\n${decodePem(config.APPLE_WWDR_CERTIFICATE_PEM!)}`;
  const key = decodePem(config.APPLE_PASS_KEY_PEM!);
  const host = APNS_HOSTS[config.APPLE_APNS_ENVIRONMENT];

  const session = connect(host, { cert, key, passphrase: config.APPLE_PASS_KEY_PASSPHRASE });
  try {
    await new Promise<void>((resolve, reject) => {
      session.on("error", reject);
      // Pass-update pushes are "alert" type with an empty payload (Apple's
      // PassKit web service spec) — "background" pushes are app wake-ups
      // that APNs throttles and iOS may silently drop, which showed up as
      // event-config changes never reaching installed passes.
      const req = session.request({
        ":method": "POST",
        ":path": `/3/device/${pushToken}`,
        "apns-topic": passTypeIdentifier,
        "apns-push-type": "alert",
      });
      // Network and DNS failures are emitted by the individual HTTP/2
      // request stream, not necessarily by the session. Without this
      // listener a transient APNs resolver failure (for example EAI_AGAIN)
      // becomes an uncaught EventEmitter error and terminates the whole
      // worker process instead of allowing BullMQ to retry this job.
      req.once("error", reject);
      req.setEncoding("utf8");
      let status = 0;
      req.on("response", (headers) => {
        status = Number(headers[":status"]);
      });
      let body = "";
      req.on("data", (chunk: string) => {
        body += chunk;
      });
      req.on("end", () => {
        if (status === 200) return resolve();
        if (status === 410) return reject(new ApplePushUnregisteredError(body));
        reject(new Error(`APNs push failed: ${status} ${body}`));
      });
      req.end(JSON.stringify({}));
    });
  } finally {
    session.close();
  }
}
