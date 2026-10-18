import {
  ProjectDraftWriter,
  projectDraftWriter,
  settleProjectDrafts,
  trackProjectTask,
} from "./projects";

jest.mock("./api", () => ({ apiFetch: jest.fn() }));

it("serializes in-flight autosaves and sends newer edits using the returned revision (H20)", async () => {
  let finish!: (value: { revision: number }) => void;
  const save = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ revision: 9 });
  const writer = new ProjectDraftWriter(7, {}, save);
  writer.change({ description: "first" });
  const flushing = writer.flush();
  writer.change({ description: "newer" });
  expect(save).toHaveBeenCalledTimes(1);
  finish({ revision: 8 });
  await flushing;
  expect(save.mock.calls).toEqual([
    [{ description: "first" }, 7],
    [{ description: "newer" }, 8],
  ]);
  expect(writer.dirty).toBe(false);
});

it("keeps failed answers and revision for an explicit retry (H20)", async () => {
  const save = jest
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ revision: 3 });
  const writer = new ProjectDraftWriter(2, {}, save);
  writer.change({ link: "https://example.com" });
  await expect(writer.flush()).rejects.toThrow("offline");
  expect(writer.dirty).toBe(true);
  await writer.flush();
  expect(save).toHaveBeenLastCalledWith({ link: "https://example.com" }, 2);
  expect(writer.dirty).toBe(false);
});

it("keeps saving every edit after its editor closes (H20)", async () => {
  let finish!: (value: { revision: number }) => void;
  const save = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<{ revision: number }>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ revision: 2 });
  const writer = new ProjectDraftWriter(0, {}, save);
  writer.change({ title: "one" });
  const flushing = writer.flush();
  writer.change({ title: "two" });
  finish({ revision: 1 });
  await flushing;
  expect(save).toHaveBeenLastCalledWith({ title: "two" }, 1);
  expect(writer.dirty).toBe(false);
});

it("reuses a project's unsaved writer for the next editor and waits for its uploads (H20)", async () => {
  const { apiFetch } = jest.requireMock("./api") as { apiFetch: jest.Mock };
  apiFetch.mockRejectedValueOnce(new Error("offline"));
  const project = { id: 41, revision: 3, responses: {} };
  const first = projectDraftWriter(project);
  first.change({ photos: ["a"] });
  await expect(first.flush()).rejects.toThrow("offline");
  const second = projectDraftWriter(project);
  expect(second).toBe(first);
  expect(second.current).toEqual({ photos: ["a"] });
  let uploaded!: () => void;
  const upload = trackProjectTask(41, new Promise<void>((resolve) => (uploaded = resolve)));
  apiFetch.mockResolvedValue({ revision: 4 });
  let settled = false;
  const settling = settleProjectDrafts(41).then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  uploaded();
  await upload;
  await settling;
  expect(first.dirty).toBe(false);
  // Once saved, the next editor starts from the server copy.
  expect(projectDraftWriter({ ...project, revision: 4 })).not.toBe(first);
});

describe("mergeProjects (H18)", () => {
  const project = (id: number, name = `p${id}`) =>
    ({ id, name, challenges: [], winners: [] }) as unknown as import("./projects").NativeProject;

  it("returns the same array when nothing changed", () => {
    const { mergeProjects } = require("./projects");
    const current = [project(1), project(2)];
    expect(mergeProjects(current, [project(1), project(2)])).toBe(current);
  });

  it("keeps unchanged rows, updates edited ones and adds new ones", () => {
    const { mergeProjects } = require("./projects");
    const current = [project(1), project(2)];
    const merged = mergeProjects(current, [project(3), project(1), project(2, "renamed")]);
    expect(merged.map((item: { id: number }) => item.id)).toEqual([3, 1, 2]);
    expect(merged[1]).toBe(current[0]);
    expect(merged[2]).not.toBe(current[1]);
  });
});
