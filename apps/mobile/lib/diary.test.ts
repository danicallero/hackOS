import { ApiError } from "./api";
import {
  type DiaryEntry,
  diaryInitials,
  diaryScanErrorKey,
  isDiaryEntryAvailable,
  sortDiaryEntries,
  upsertDiaryEntry,
} from "./diary";

jest.mock("./api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

function entry(id: number, overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id,
    kind: "person",
    starred: false,
    note: null,
    createdAt: `2026-10-10T10:00:0${id}.000Z`,
    updatedAt: `2026-10-10T10:00:0${id}.000Z`,
    person: {
      userId: 100 + id,
      displayName: `Person ${id}`,
      photoUrl: null,
      headline: null,
      locationNote: null,
      project: null,
      challenges: [],
    },
    sponsor: null,
    ...overrides,
  };
}

describe("diary ordering (#935)", () => {
  it("puts favourites first, then the most recently saved", () => {
    const sorted = sortDiaryEntries([entry(1), entry(2, { starred: true }), entry(3)]);
    expect(sorted.map((item) => item.id)).toEqual([2, 3, 1]);
  });

  it("replaces an updated entry in place of the old copy and re-sorts", () => {
    const list = [entry(1), entry(2)];
    const updated = upsertDiaryEntry(list, { ...entry(1), starred: true, note: "hi" });
    expect(updated.map((item) => [item.id, item.starred])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(updated).toHaveLength(2);
  });

  it("adds a newly scanned entry", () => {
    expect(upsertDiaryEntry([entry(1)], entry(4)).map((item) => item.id)).toEqual([4, 1]);
  });
});

describe("diary cards", () => {
  it("treats hidden people and unrevealed sponsors as unavailable", () => {
    expect(isDiaryEntryAvailable(entry(1))).toBe(true);
    expect(isDiaryEntryAvailable(entry(1, { person: null }))).toBe(false);
    expect(isDiaryEntryAvailable(entry(2, { kind: "sponsor", person: null }))).toBe(false);
  });

  it("derives up to two initials", () => {
    expect(diaryInitials("Ana S.")).toBe("AS");
    expect(diaryInitials("élia  maría  pérez")).toBe("ÉM");
    expect(diaryInitials("Ana")).toBe("A");
  });
});

describe("diaryScanErrorKey", () => {
  it.each([
    ["diary_code_unknown", 404, "diaryScanUnknown"],
    ["badge_revoked", 409, "diaryScanRevoked"],
    ["profile_not_shared", 409, "diaryScanNotShared"],
    ["stand_unavailable", 409, "diaryScanStandUnavailable"],
    ["diary_self", 409, "diaryScanSelf"],
    ["forbidden", 403, "diaryForbidden"],
    ["too_many_requests", 429, "diaryScanRateLimited"],
    ["conflict", 409, "diaryScanError"],
  ])("maps %s (%i) to %s", (code, status, key) => {
    expect(diaryScanErrorKey(new ApiError("x", status, code))).toBe(key);
  });

  it("falls back for transport failures", () => {
    expect(diaryScanErrorKey(new Error("Network request failed"))).toBe("diaryScanError");
  });
});
