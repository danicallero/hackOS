import { act, renderHook } from "@testing-library/react-native";
import {
  seedTopicSelection,
  setOtherSelection,
  setTopicSelection,
  useTopicSelection,
} from "./help-topic-selection";

describe("help topic draft (H61, H64)", () => {
  it("offers Other only when the form seeds it, and restores a discarded visit", async () => {
    seedTopicSelection([{ id: 1, name: "Frontend" }], 5, false);
    const { result } = await renderHook(() => useTopicSelection());
    expect(result.current).toMatchObject({ allowOther: true, other: false });
    const opening = result.current;
    await act(async () => setOtherSelection(true));
    expect(result.current).toMatchObject({ other: true, selected: [] });
    await act(async () => setTopicSelection([{ id: 2, name: "Backend" }]));
    expect(result.current).toMatchObject({ other: false, selected: [{ id: 2, name: "Backend" }] });
    await act(async () => setOtherSelection(true));
    expect(result.current.selected).toEqual([]);
    await act(async () => {
      setTopicSelection(opening.selected);
      setOtherSelection(opening.other);
    });
    expect(result.current).toMatchObject({ other: false, selected: [{ id: 1, name: "Frontend" }] });
    await act(async () => seedTopicSelection([], 20));
    expect(result.current.allowOther).toBe(false);
  });
});
