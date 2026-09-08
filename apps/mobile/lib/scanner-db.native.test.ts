const mockExecStatements: string[] = [];
const mockRunStatements: Array<{ sql: string; args: unknown[] }> = [];

class FakeDatabase {
  async execAsync(sql: string): Promise<void> {
    mockExecStatements.push(sql);
  }

  async runAsync(sql: string, ...args: unknown[]): Promise<{ changes: number }> {
    mockRunStatements.push({ sql, args });
    return { changes: 1 };
  }

  async getAllAsync<T>(sql = ""): Promise<T[]> {
    const table = sql.match(/table_info\(([^)]+)\)/)?.[1];
    const columns: Record<string, string[]> = {
      scanner_people: ["user_id", "ticket_token", "badge_id", "encrypted_payload"],
      revoked_badges: ["badge_id"],
      revoked_tickets: ["ticket_token"],
      scanner_activities: [
        "id",
        "name",
        "category",
        "requires_scan",
        "starts_at",
        "primary_language",
        "name_i18n",
        "description_i18n",
      ],
      scanner_activity_states: ["user_id", "activity_id", "scan_count"],
      scanner_metadata: ["key", "value"],
      pending_scans: [
        "id",
        "kind",
        "created_by_user_id",
        "encrypted_payload",
        "status",
        "attempts",
        "last_error",
        "created_at",
        "acknowledged_at",
        "clock_corrected",
      ],
      scanner_sync_errors: [
        "id",
        "scan_id",
        "created_by_user_id",
        "kind",
        "error_type",
        "message",
        "occurred_at",
      ],
    };
    return (columns[table ?? ""] ?? []).map((name) => ({ name })) as T[];
  }

  async withTransactionAsync(work: () => Promise<void>): Promise<void> {
    await work();
  }

  async withExclusiveTransactionAsync(
    work: (transaction: FakeDatabase) => Promise<void>,
  ): Promise<void> {
    await work(this);
  }

  async closeAsync(): Promise<void> {}
}

const mockDatabase = new FakeDatabase();

jest.mock("expo-file-system", () => ({
  File: class {
    exists = false;
    delete() {}
  },
  Paths: { cache: { uri: "cache://" }, document: { uri: "document://" } },
}));

jest.mock("expo-sqlite", () => ({
  defaultDatabaseDirectory: "database://",
  deleteDatabaseAsync: jest.fn(),
  openDatabaseAsync: jest.fn(async () => mockDatabase),
}));

jest.mock("./scanner-crypto", () => ({
  decryptJson: jest.fn(),
  encryptJson: jest.fn(async (payload: unknown) => {
    const name = (payload as { name?: string }).name;
    return `encrypted-${name ?? ""}`;
  }),
  getQueueKey: jest.fn(),
  getRosterKey: jest.fn(async () => "roster-key"),
  resetQueueKey: jest.fn(),
  resetRosterKey: jest.fn(),
}));

jest.mock("./scanner-model", () => ({ revokedBadgesFromSnapshot: jest.fn(() => []) }));

import * as SQLite from "expo-sqlite";
import { encryptJson } from "./scanner-crypto";
import { applyScannerSnapshot, enqueueLocalScan, wipeAttendanceRoster } from "./scanner-db.native";
import type { ScannerSnapshot } from "./scanner-types";

function snapshot(name: string): ScannerSnapshot {
  return {
    generatedAt: `2026-01-01T00:00:0${name === "A" ? "1" : "2"}.000Z`,
    people: [
      {
        userId: name === "A" ? 1 : 2,
        email: `${name.toLowerCase()}@example.test`,
        role: "Participant",
        hasCapabilities: false,
        isEnterpriseJudge: false,
        eventAccess: true,
        ticketToken: `ticket-${name}`,
        badgeId: `badge-${name}`,
        revokedBadgeIds: [],
        name,
        surname: "User",
        dni: null,
        accepted: true,
        confirmed: true,
        intolerances: [],
        foodIntoleranceNotes: null,
        notes: null,
        lastPresenceKind: null,
        lastPresenceAt: null,
      },
    ],
    activities: [],
    activityStates: [],
  };
}

describe("native scanner roster generation fencing", () => {
  beforeEach(() => {
    mockExecStatements.length = 0;
    mockRunStatements.length = 0;
    jest.mocked(encryptJson).mockImplementation(async (payload: unknown) => {
      const name = (payload as { name?: string }).name;
      return `encrypted-${name ?? ""}`;
    });
  });

  it("does not install a delayed account-A snapshot after sign-out and account-B sync", async () => {
    let releaseA!: () => void;
    const aEncryptionStarted = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let aStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      aStarted = resolve;
    });
    jest.mocked(encryptJson).mockImplementation(async (payload: unknown) => {
      const name = (payload as { name?: string }).name;
      if (name === "A") {
        aStarted();
        await aEncryptionStarted;
      }
      return `encrypted-${name ?? ""}`;
    });

    const accountASnapshot = applyScannerSnapshot(snapshot("A"), 1);
    await started;
    const signOut = wipeAttendanceRoster(1);
    const accountBSnapshot = applyScannerSnapshot(snapshot("B"), 2);
    releaseA();

    await Promise.all([accountASnapshot, signOut, accountBSnapshot]);

    const installedSnapshots = mockRunStatements.filter(({ sql }) =>
      sql.includes("INSERT INTO scanner_people"),
    );
    expect(installedSnapshots).toHaveLength(1);
    expect(installedSnapshots[0]?.args).toContain("encrypted-B");
    expect(installedSnapshots[0]?.args).not.toContain("encrypted-A");
  });

  it("does not create the ownerless legacy database on a fresh queue", async () => {
    jest.mocked(SQLite.openDatabaseAsync).mockClear();

    await enqueueLocalScan(
      { kind: "accreditation", ticketToken: "ticket-A", badgeId: "badge-A", method: "manual" },
      7,
    );

    expect(SQLite.openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith("hackos-scanner-queue.db");
  });

  it("stores a native Date timestamp as text in scanner metadata", async () => {
    const generatedAt = new Date("2026-01-01T00:00:03.000Z");
    const revivedSnapshot = {
      ...snapshot("A"),
      generatedAt,
    } as unknown as ScannerSnapshot;

    await applyScannerSnapshot(revivedSnapshot, 7);

    const metadataInsert = mockRunStatements.find(({ sql }) =>
      sql.includes("INSERT INTO scanner_metadata"),
    );
    expect(metadataInsert?.args).toEqual([generatedAt.toISOString()]);
  });
});
