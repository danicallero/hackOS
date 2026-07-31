import { findQueueEntries, type QueueEntry, type RoomView } from "@/lib/queue-search";

function entry(overrides: Partial<QueueEntry> & { id: number }): QueueEntry {
  return { position: 61, status: "waiting", ...overrides };
}

function roomView(
  id: number,
  name: string,
  challengeTitle: string | null,
  overrides: Partial<RoomView> = {},
): RoomView {
  return {
    room: { id, name, location: null },
    state: { is_paused: false },
    challenge: challengeTitle ? { id: 1, title: challengeTitle, enterprise_name: "GPUL" } : null,
    active: null,
    called: [],
    next: [],
    ...overrides,
  };
}

const team = entry({
  id: 900,
  repo_name: "K2 Platform",
  repo_members: [{ email: "daniel@example.com", name: "Daniel", surname: "Callero" }],
});

describe("findQueueEntries", () => {
  it("returns nothing for a blank query", () => {
    expect(
      findQueueEntries([roomView(1, "Aula 3.0", "Retos GPUL", { next: [team] })], "  "),
    ).toEqual([]);
  });

  it("folds the same waiting entry across rooms into one result listing every room", () => {
    const rooms = [
      roomView(3, "Aula 3.6", "Retos GPUL", { next: [team] }),
      roomView(1, "Aula 3.0", "Retos GPUL", { next: [team] }),
      roomView(2, "Aula 3.1", "Retos GPUL", { next: [team] }),
    ];

    const results = findQueueEntries(rooms, "daniel ca");

    expect(results).toHaveLength(1);
    expect(results[0].entry.id).toBe(900);
    expect(results[0].challengeTitle).toBe("Retos GPUL");
    expect(results[0].rooms.map((room) => room.name)).toEqual(["Aula 3.0", "Aula 3.1", "Aula 3.6"]);
  });

  it("keeps one result per entry when a team is queued for several challenges", () => {
    const other = entry({ id: 901, repo_name: "K2 Platform", repo_members: team.repo_members });
    const rooms = [
      roomView(1, "Aula 3.0", "Retos GPUL", { next: [team] }),
      roomView(2, "Aula 4.0", "Reto K2", { next: [other] }),
    ];

    const results = findQueueEntries(rooms, "k2 plat");

    expect(results.map((result) => result.challengeTitle)).toEqual(["Reto K2", "Retos GPUL"]);
    expect(results.every((result) => result.rooms.length === 1)).toBe(true);
  });

  it("matches team name, member name and email, and ignores non-matching entries", () => {
    const stranger = entry({ id: 902, repo_name: "Other team" });
    const rooms = [roomView(1, "Aula 3.0", "Retos GPUL", { next: [team, stranger] })];

    expect(findQueueEntries(rooms, "K2 PLAT")).toHaveLength(1);
    expect(findQueueEntries(rooms, "callero")).toHaveLength(1);
    expect(findQueueEntries(rooms, "daniel@example.com")).toHaveLength(1);
    expect(findQueueEntries(rooms, "nobody")).toHaveLength(0);
  });

  it("includes called and presenting entries with their assigned room", () => {
    const called = entry({ id: 903, repo_name: "K2 Platform", status: "called", position: null });
    const presenting = entry({ id: 904, repo_name: "K2 Platform", status: "presenting" });
    const rooms = [
      roomView(1, "Aula 3.0", "Retos GPUL", { called: [called] }),
      roomView(2, "Aula 3.1", "Retos GPUL", { active: presenting }),
    ];

    const results = findQueueEntries(rooms, "k2");

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.rooms.map((room) => room.name))).toEqual([
      ["Aula 3.0"],
      ["Aula 3.1"],
    ]);
  });

  it("sorts by team name then challenge", () => {
    const zeta = entry({ id: 905, repo_name: "Zeta" });
    const alpha = entry({ id: 906, repo_name: "Alpha" });
    const rooms = [roomView(1, "Aula 3.0", "Retos GPUL", { next: [zeta, alpha] })];

    expect(findQueueEntries(rooms, "a").map((result) => result.entry.repo_name)).toEqual([
      "Alpha",
      "Zeta",
    ]);
  });
});
