import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { config } from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import {
  BadRequestError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { ensurePassRecord, type PassRow, type Purpose } from "./wallet-passes.js";

const execFileAsync = promisify(execFile);
export const PASS_TYPE_IDENTIFIER = config.APPLE_PASS_TYPE_IDENTIFIER ?? "pass.local.hackos";
const TEAM_IDENTIFIER = config.APPLE_TEAM_IDENTIFIER ?? "LOCALTEAM";
const ORGANIZATION_NAME = config.APPLE_PASS_ORGANIZATION;

function appleAuthToken(header: string | undefined): string {
  const prefix = "ApplePass ";
  if (!header?.startsWith(prefix)) throw new UnauthorizedError();
  return header.slice(prefix.length);
}

async function requirePassBySerial(serialNumber: string, authorization?: string): Promise<PassRow> {
  const token = appleAuthToken(authorization);
  const { rows } = await pool.query(
    `SELECT id, user_id, purpose, serial_number, authentication_token, status, update_tag
       FROM wallet_passes
      WHERE platform = 'apple' AND serial_number = $1 AND authentication_token = $2`,
    [serialNumber, token],
  );
  if (!rows[0]) throw new UnauthorizedError();
  return rows[0];
}

async function passPayload(pass: PassRow) {
  const { rows } = await pool.query(
    `SELECT u.name, u.surname, u.badge_id, t.token
       FROM users u
       LEFT JOIN tickets t ON t.user_id = u.id
      WHERE u.id = $1`,
    [pass.user_id],
  );
  const u = rows[0];
  if (!u) throw new NotFoundError("User not found");
  if (pass.purpose === "ticket" && !u.token) throw new NotFoundError("Ticket not issued");
  if (pass.purpose === "badge" && !u.badge_id) throw new BadRequestError("Badge not assigned");

  const fullName = [u.name, u.surname].filter(Boolean).join(" ") || `User ${pass.user_id}`;
  const barcode = pass.purpose === "ticket" ? u.token : u.badge_id;
  return {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_IDENTIFIER,
    teamIdentifier: TEAM_IDENTIFIER,
    organizationName: ORGANIZATION_NAME,
    description: pass.purpose === "ticket" ? "hackOS ticket" : "hackOS badge",
    serialNumber: pass.serial_number,
    authenticationToken: pass.authentication_token,
    webServiceURL: `${config.BETTER_AUTH_URL}/api/wallet/apple/v1`,
    sharingProhibited: true,
    voided: pass.status === "voided",
    eventTicket: {
      primaryFields: [{ key: "name", label: "Participant", value: fullName }],
      secondaryFields: [{ key: "purpose", label: "Pass", value: pass.purpose }],
    },
    barcode: {
      message: barcode,
      format: "PKBarcodeFormatQR",
      messageEncoding: "iso-8859-1",
    },
    barcodes: [
      {
        message: barcode,
        format: "PKBarcodeFormatQR",
        messageEncoding: "iso-8859-1",
      },
    ],
    foregroundColor: "rgb(255,255,255)",
    backgroundColor: "rgb(31,36,48)",
    labelColor: "rgb(221,227,238)",
  };
}

export async function buildApplePass(
  userId: number | null,
  purpose: Purpose | null,
  lookup?: { passTypeIdentifier: string; serialNumber: string; authorization?: string },
): Promise<Buffer> {
  if (lookup && lookup.passTypeIdentifier !== PASS_TYPE_IDENTIFIER) {
    throw new NotFoundError("Pass type not recognized");
  }
  const pass = lookup
    ? await requirePassBySerial(lookup.serialNumber, lookup.authorization)
    : await ensurePassRecord(userId ?? 0, purpose ?? "ticket", "apple");
  if (pass.status === "voided" && !lookup) throw new BadRequestError("Pass has been voided");

  const passJson = JSON.stringify(await passPayload(pass));
  const manifest = {
    "pass.json": createHash("sha1").update(passJson).digest("hex"),
  };
  const manifestJson = JSON.stringify(manifest);
  const signature = await signManifest(manifestJson);
  return zipStore([
    { name: "pass.json", data: Buffer.from(passJson) },
    { name: "manifest.json", data: Buffer.from(manifestJson) },
    { name: "signature", data: signature },
  ]);
}

function decodePem(base64: string): string {
  return Buffer.from(base64, "base64").toString("utf8");
}

/**
 * Signs the manifest with the configured Pass Type ID certificate. Never
 * returns an empty/invalid signature — an unconfigured or broken signing
 * setup throws explicitly (H28: "production cannot serve unsigned Apple
 * passes"), in every environment, not just production.
 */
async function signManifest(manifestJson: string): Promise<Buffer> {
  if (!config.appleWalletConfigured) {
    throw new ServiceUnavailableError(
      "Apple Wallet signing is not configured (APPLE_PASS_CERTIFICATE_PEM / APPLE_PASS_KEY_PEM / APPLE_WWDR_CERTIFICATE_PEM)",
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "hackos-pass-"));
  try {
    const manifestPath = join(dir, "manifest.json");
    const signaturePath = join(dir, "signature");
    const certPath = join(dir, "cert.pem");
    const keyPath = join(dir, "key.pem");
    const wwdrPath = join(dir, "wwdr.pem");
    await writeFile(manifestPath, manifestJson);
    await writeFile(certPath, decodePem(config.APPLE_PASS_CERTIFICATE_PEM!), { mode: 0o600 });
    await writeFile(keyPath, decodePem(config.APPLE_PASS_KEY_PEM!), { mode: 0o600 });
    await writeFile(wwdrPath, decodePem(config.APPLE_WWDR_CERTIFICATE_PEM!), { mode: 0o600 });
    const passphraseArgs = config.APPLE_PASS_KEY_PASSPHRASE
      ? ["-passin", `pass:${config.APPLE_PASS_KEY_PASSPHRASE}`]
      : [];

    try {
      await execFileAsync("openssl", [
        "smime",
        "-binary",
        "-sign",
        "-certfile",
        wwdrPath,
        "-signer",
        certPath,
        "-inkey",
        keyPath,
        ...passphraseArgs,
        "-in",
        manifestPath,
        "-out",
        signaturePath,
        "-outform",
        "DER",
      ]);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ServiceUnavailableError(
          "openssl binary not found — install openssl in the runtime image to sign Apple passes",
        );
      }
      throw err;
    }
    return await readFile(signaturePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function registerAppleDevice(input: {
  deviceLibraryIdentifier: string;
  serialNumber: string;
  authorization?: string;
  pushToken: string;
}): Promise<boolean> {
  const pass = await requirePassBySerial(input.serialNumber, input.authorization);
  return withTransaction(async (client) => {
    const r = await client.query(
      `INSERT INTO wallet_pass_devices (pass_id, device_library_identifier, push_token)
       VALUES ($1, $2, $3)
       ON CONFLICT (pass_id, device_library_identifier)
       DO UPDATE SET push_token = EXCLUDED.push_token
       RETURNING (xmax = 0) AS inserted`,
      [pass.id, input.deviceLibraryIdentifier, input.pushToken],
    );
    const inserted = Boolean(r.rows[0]?.inserted);
    await audit(client, {
      actorId: pass.user_id,
      entityType: "wallet_pass_device",
      entityId: `${pass.id}:${input.deviceLibraryIdentifier}`,
      action: inserted ? "registered" : "updated",
      after: { passId: pass.id, deviceLibraryIdentifier: input.deviceLibraryIdentifier },
    });
    return inserted;
  });
}

export async function unregisterAppleDevice(input: {
  deviceLibraryIdentifier: string;
  serialNumber: string;
  authorization?: string;
}): Promise<void> {
  const pass = await requirePassBySerial(input.serialNumber, input.authorization);
  await withTransaction(async (client) => {
    const r = await client.query(
      `DELETE FROM wallet_pass_devices
        WHERE pass_id = $1 AND device_library_identifier = $2
        RETURNING pass_id`,
      [pass.id, input.deviceLibraryIdentifier],
    );
    if ((r.rowCount ?? 0) > 0) {
      await audit(client, {
        actorId: pass.user_id,
        entityType: "wallet_pass_device",
        entityId: `${pass.id}:${input.deviceLibraryIdentifier}`,
        action: "unregistered",
        before: { passId: pass.id, deviceLibraryIdentifier: input.deviceLibraryIdentifier },
      });
    }
  });
}

export async function appleChangedSerials(input: {
  deviceLibraryIdentifier: string;
  passTypeIdentifier: string;
  passesUpdatedSince?: string;
}) {
  if (input.passTypeIdentifier !== PASS_TYPE_IDENTIFIER) {
    return { lastUpdated: Date.now().toString(), serialNumbers: [] };
  }
  const { rows } = await pool.query(
    `SELECT wp.serial_number, wp.update_tag
       FROM wallet_pass_devices d
       JOIN wallet_passes wp ON wp.id = d.pass_id
      WHERE d.device_library_identifier = $1
        AND ($2::text IS NULL OR wp.update_tag > $2)
      ORDER BY wp.serial_number`,
    [input.deviceLibraryIdentifier, input.passesUpdatedSince ?? null],
  );
  const serialNumbers = rows.map((r: { serial_number: string }) => r.serial_number);
  const lastUpdated =
    rows.reduce(
      (m: string, r: { update_tag: string }) => (r.update_tag > m ? r.update_tag : m),
      "",
    ) ||
    (input.passesUpdatedSince ?? Date.now().toString());
  return { lastUpdated, serialNumbers };
}

export async function appleLog(logs: string[]) {
  await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_WALLET_PASS_UPDATED, {
    source: "apple-log",
    count: logs.length,
  });
  return {};
}

const CRC_TABLE = new Uint32Array(256).map((_, i) => {
  let c = i;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ name: string; data: Buffer }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(file.data.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    local.push(localHeader, name, file.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(file.data.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + file.data.length;
  }

  const centralOffset = offset;
  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...local, ...central, end]);
}
