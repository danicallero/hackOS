const mockExecStatements: string[] = [];

class FakeDatabase {
  async execAsync(sql: string): Promise<void> {
    mockExecStatements.push(sql);
  }

  async getAllAsync<T>(): Promise<T[]> {
    return [{ name: "primary_language" }] as T[];
  }

  async withTransactionAsync(work: () => Promise<void>): Promise<void> {
    await work();
  }
}

const mockDatabase = new FakeDatabase();

jest.mock("expo-file-system", () => ({
  File: class {
    exists = false;
    delete() {}
  },
  Paths: { cache: { uri: "cache://" } },
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

import { encryptJson } from "./scanner-crypto";
import { applyScannerSnapshot, wipeAttendanceRoster } from "./scanner-db.native";
import type { ScannerSnapshot } from "./scanner-types";

function snapshot(name: string): ScannerSnapshot {
  return {
    generatedAt: `2026-01-01T00:00:0${name === "A" ? "1" : "2"}.000Z`,
    people: [
      {
        userId: name === "A" ? 1 : 2,
        email: `${name.toLowerCase()}@example.test`,
        role: "participant",
        ticketToken: `ticket-${name}`,
        badgeId: `badge-${name}`,
        revokedBadgeIds: [],
        name,
        surname: "User",
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

    const installedSnapshots = mockExecStatements.filter((sql) =>
      sql.includes("INSERT INTO scanner_people"),
    );
    expect(installedSnapshots).toHaveLength(1);
    expect(installedSnapshots[0]).toContain("encrypted-B");
    expect(installedSnapshots[0]).not.toContain("encrypted-A");
  });
});
