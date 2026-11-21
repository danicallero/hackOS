import type { DiaryEntry } from "./diary";
import { apiImageSource, cvFileName, filterDiaryEntries, foldSearchText } from "./directory";

jest.mock("./api", () => ({ getCurrentSessionCookie: () => "session=1" }));
jest.mock("./env", () => ({ API_URL: "https://api.test/" }));

function entry(id: number, overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id,
    kind: "person",
    starred: false,
    note: null,
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T10:00:00.000Z",
    person: {
      userId: 100 + id,
      displayName: `Person ${id}`,
      photoUrl: null,
      headline: null,
      locationNote: null,
      projects: [],
      challenges: [],
    },
    sponsor: null,
    ...overrides,
  };
}

describe("directory helpers (#935)", () => {
  it("folds accents, case and spacing", () => {
    expect(foldSearchText("  Martín   ÁLVAREZ ")).toBe("martin alvarez");
  });

  it("matches every visible card field and the owner's note", () => {
    const entries = [
      entry(1, { note: "Café chat" }),
      entry(2, {
        person: {
          ...entry(2).person!,
          projects: [{ kind: "project", id: 1, name: "Rover" }],
          challenges: [{ id: 3, name: "Robótica" }],
        },
      }),
    ];
    expect(filterDiaryEntries(entries, { query: "cafe", favouritesOnly: false })).toEqual([
      entries[0],
    ]);
    expect(filterDiaryEntries(entries, { query: "robotica", favouritesOnly: false })).toEqual([
      entries[1],
    ]);
    expect(filterDiaryEntries(entries, { query: "rover", favouritesOnly: false })).toEqual([
      entries[1],
    ]);
  });

  it("keeps only favorites when asked", () => {
    const entries = [entry(1), entry(2, { starred: true })];
    expect(filterDiaryEntries(entries, { query: "", favouritesOnly: true })).toEqual([entries[1]]);
  });

  it("builds a session expo-image source for API photos and passes public logos through", () => {
    const source = apiImageSource("/api/users/1/photo?v=a");
    expect(source).toEqual({
      uri: "https://api.test/api/users/1/photo?v=a",
      headers: { Cookie: "session=1" },
      cacheKey: expect.stringMatching(/:https:\/\/api\.test\/api\/users\/1\/photo\?v=a$/),
    });
    expect(source.cacheKey).not.toContain("session=1");
    expect(apiImageSource("/api/users/1/photo?v=a").cacheKey).toBe(source.cacheKey);
    expect(apiImageSource("https://cdn.test/logo.png")).toEqual({
      uri: "https://cdn.test/logo.png",
    });
  });

  it("derives a safe CV file name", () => {
    expect(cvFileName("José Ñúñez")).toBe("jose-nunez-cv.pdf");
    expect(cvFileName("???")).toBe("cv.pdf");
  });
});
