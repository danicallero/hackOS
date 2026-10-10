import type { DiaryEntry } from "./diary";
import { cvFileName, filterDiaryEntries, foldSearchText, loadApiImage } from "./directory";

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
      project: null,
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
          project: { kind: "project", id: 1, name: "Rover" },
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

  it("keeps only favourites when asked", () => {
    const entries = [entry(1), entry(2, { starred: true })];
    expect(filterDiaryEntries(entries, { query: "", favouritesOnly: true })).toEqual([entries[1]]);
  });

  it("fetches authenticated photos once per session and passes public logos through", async () => {
    const blob = { size: 3 } as Blob;
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, blob: async () => blob } as unknown as Response);
    global.fetch = fetchMock;
    class Reader {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      error = null;
      readAsDataURL() {
        this.result = "data:image/jpeg;base64,AAA";
        this.onload?.();
      }
    }
    global.FileReader = Reader as unknown as typeof FileReader;
    await expect(loadApiImage("/api/users/1/photo?v=a")).resolves.toBe(
      "data:image/jpeg;base64,AAA",
    );
    await loadApiImage("/api/users/1/photo?v=a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/api/users/1/photo?v=a", {
      headers: { Cookie: "session=1" },
    });
    await expect(loadApiImage("https://cdn.test/logo.png")).resolves.toBe(
      "https://cdn.test/logo.png",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failed photo request", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404 } as unknown as Response);
    global.fetch = fetchMock;
    await expect(loadApiImage("/api/users/2/photo?v=b")).rejects.toThrow("404");
    await expect(loadApiImage("/api/users/2/photo?v=b")).rejects.toThrow("404");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("derives a safe CV file name", () => {
    expect(cvFileName("José Ñúñez")).toBe("jose-nunez-cv.pdf");
    expect(cvFileName("???")).toBe("cv.pdf");
  });
});
