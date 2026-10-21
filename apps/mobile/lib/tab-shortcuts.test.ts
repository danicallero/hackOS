import { tabShortcuts } from "@/lib/tab-shortcuts";

describe("tabShortcuts", () => {
  it("numbers destinations in the order shown, direct before overflow", () => {
    expect(tabShortcuts(["schedule", "scan", "queue"])).toEqual([
      { id: "schedule", input: "1" },
      { id: "scan", input: "2" },
      { id: "queue", input: "3" },
    ]);
  });

  it("adds Command+comma for Account and caps the numbering at nine", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "account"];
    const shortcuts = tabShortcuts(ids);
    expect(shortcuts.filter((s) => s.input !== ",")).toHaveLength(9);
    expect(shortcuts.at(-1)).toEqual({ id: "account", input: "," });
  });

  it("registers nothing for no destinations", () => {
    expect(tabShortcuts([])).toEqual([]);
  });
});
