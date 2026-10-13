import { ProjectDraftWriter } from "./projects";

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

it("does not start another save after its editor is disposed (H20)", async () => {
  let finish!: (value: { revision: number }) => void;
  const save = jest.fn(
    () =>
      new Promise<{ revision: number }>((resolve) => {
        finish = resolve;
      }),
  );
  const writer = new ProjectDraftWriter(0, {}, save);
  writer.change({ title: "one" });
  const flushing = writer.flush();
  writer.change({ title: "two" });
  writer.dispose();
  finish({ revision: 1 });
  await flushing;
  expect(save).toHaveBeenCalledTimes(1);
});
